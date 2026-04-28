import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/notifications/telegram/test/route";
import { getNotificationSecretsPath } from "@/lib/notifications/secrets";

vi.mock("@/lib/notifications/channels/telegram", () => ({
  sendTelegramNotification: vi.fn(),
}));

const telegramChannel = vi.mocked(await import("@/lib/notifications/channels/telegram"));
const originalConfigDir = process.env.AIPANEL_CONFIG_DIR;
const originalWriteToken = process.env.AIPANEL_WRITE_TOKEN;

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-telegram-test-api-"));
  process.env.AIPANEL_CONFIG_DIR = configDir;

  try {
    await run(configDir);
  } finally {
    if (originalConfigDir) {
      process.env.AIPANEL_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.AIPANEL_CONFIG_DIR;
    }
    await fs.rm(configDir, { recursive: true, force: true });
  }
}

async function writeSecrets(configDir: string, content: unknown) {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getNotificationSecretsPath(), `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

function request(headers: HeadersInit = {}) {
  return new Request("http://localhost/api/notifications/telegram/test", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      ...headers,
    },
  });
}

function expectSanitized(body: unknown, configDir: string) {
  const raw = JSON.stringify(body);
  expect(raw).not.toContain("telegramBotToken");
  expect(raw).not.toContain("secret-token");
  expect(raw).not.toContain(configDir);
  expect(raw).not.toContain("notification-secrets.json");
}

afterEach(() => {
  vi.restoreAllMocks();

  if (originalConfigDir) {
    process.env.AIPANEL_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.AIPANEL_CONFIG_DIR;
  }

  if (originalWriteToken !== undefined) {
    process.env.AIPANEL_WRITE_TOKEN = originalWriteToken;
  } else {
    delete process.env.AIPANEL_WRITE_TOKEN;
  }
});

describe("POST /api/notifications/telegram/test", () => {
  it("returns 400 when configuration is missing", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Telegram is not configured" });
      expectSanitized(body, configDir);
      expect(telegramChannel.sendTelegramNotification).not.toHaveBeenCalled();
    });
  });

  it("rejects unknown cross-origin requests with 403", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await POST(request({ Origin: "https://evil.example" }));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "Forbidden" });
      expectSanitized(body, configDir);
      expect(telegramChannel.sendTelegramNotification).not.toHaveBeenCalled();
    });
  });

  it("requires write token when configured", async () => {
    await withTempConfigDir(async (configDir) => {
      process.env.AIPANEL_WRITE_TOKEN = "secret-write-token";

      const denied = await POST(request());
      const deniedBody = await denied.json();

      expect(denied.status).toBe(401);
      expect(deniedBody).toEqual({ error: "Unauthorized" });
      expectSanitized(deniedBody, configDir);
      expect(telegramChannel.sendTelegramNotification).not.toHaveBeenCalled();

      const allowed = await POST(
        request({ "x-aipanel-write-token": "secret-write-token" }),
      );
      expect(allowed.status).toBe(400);
    });
  });

  it("sends test notification when configured", async () => {
    await withTempConfigDir(async (configDir) => {
      await writeSecrets(configDir, {
        telegramBotToken: "123456:secret-token",
        telegramChatId: "-100123456789",
      });
      telegramChannel.sendTelegramNotification.mockResolvedValue();

      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(telegramChannel.sendTelegramNotification).toHaveBeenCalledTimes(1);

      const [notification, config] = telegramChannel.sendTelegramNotification.mock.calls[0] ?? [];
      expect(notification).toMatchObject({
        kind: "permission",
        title: "Permission request",
        projectSlug: "aipanel",
      });
      expect(config).toEqual({
        botToken: "123456:secret-token",
        chatId: "-100123456789",
      });
      expectSanitized(body, configDir);
    });
  });

  it("sanitizes Telegram sender errors", async () => {
    await withTempConfigDir(async (configDir) => {
      await writeSecrets(configDir, {
        telegramBotToken: "123456:secret-token",
        telegramChatId: "-100123456789",
      });

      telegramChannel.sendTelegramNotification.mockRejectedValue(
        new Error("Telegram notification request failed (401): bad token 123456:secret-token"),
      );

      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(502);
      expect(body).toEqual({ error: "Unable to send Telegram test message" });
      expectSanitized(body, configDir);
      expect(JSON.stringify(body)).not.toContain("123456:secret-token");
    });
  });
});

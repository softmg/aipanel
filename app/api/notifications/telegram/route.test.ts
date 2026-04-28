import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/notifications/telegram/route";
import { getNotificationSecretsPath } from "@/lib/notifications/secrets";

const originalConfigDir = process.env.AIPANEL_CONFIG_DIR;
const originalWriteToken = process.env.AIPANEL_WRITE_TOKEN;

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-telegram-api-"));
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

function settingsRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/notifications/telegram", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      ...headers,
    },
  });
}

function rawRequest(body: string, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/notifications/telegram", {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "application/json",
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

describe("GET /api/notifications/telegram", () => {
  it("returns unconfigured status when the secrets file is missing", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ configured: false, botTokenConfigured: false });
      expectSanitized(body, configDir);
    });
  });
});

describe("PUT /api/notifications/telegram", () => {
  it("stores token and chat ID and returns safe status", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await PUT(
        settingsRequest({
          botToken: "123456:secret-token",
          chatId: "-100123456789",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        configured: true,
        botTokenConfigured: true,
        chatId: "-100123456789",
      });

      const savedRaw = await fs.readFile(getNotificationSecretsPath(), "utf8");
      const saved = JSON.parse(savedRaw);
      expect(saved).toEqual({
        telegramBotToken: "123456:secret-token",
        telegramChatId: "-100123456789",
      });
      expectSanitized(body, configDir);
    });
  });

  it("does not include bot token in response", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await PUT(
        settingsRequest({
          botToken: "123456:secret-token",
          chatId: "-100123456789",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(JSON.stringify(body)).not.toContain("123456:secret-token");
      expect(JSON.stringify(body)).not.toContain("telegramBotToken");
      expectSanitized(body, configDir);
    });
  });

  it("rejects invalid JSON with 400", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await PUT(rawRequest("{"));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Invalid JSON" });
      expectSanitized(body, configDir);
    });
  });

  it("rejects invalid payload with 400", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await PUT(settingsRequest({ botToken: "", chatId: 123 }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Invalid Telegram settings" });
      expectSanitized(body, configDir);
    });
  });

  it("rejects unknown cross-origin requests with 403", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await PUT(
        settingsRequest(
          {
            botToken: "123456:secret-token",
            chatId: "-100123456789",
          },
          { Origin: "https://evil.example" },
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "Forbidden" });
      expectSanitized(body, configDir);
    });
  });

  it("rejects non-json content type with 415", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await PUT(
        new Request("http://localhost/api/notifications/telegram", {
          method: "PUT",
          body: JSON.stringify({
            botToken: "123456:secret-token",
            chatId: "-100123456789",
          }),
          headers: {
            Origin: "http://localhost",
            "Content-Type": "text/plain",
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(415);
      expect(body).toEqual({ error: "Unsupported Media Type" });
      expectSanitized(body, configDir);
    });
  });

  it("requires write token when configured", async () => {
    await withTempConfigDir(async (configDir) => {
      process.env.AIPANEL_WRITE_TOKEN = "secret-write-token";

      const denied = await PUT(
        settingsRequest({
          botToken: "123456:secret-token",
          chatId: "-100123456789",
        }),
      );
      const deniedBody = await denied.json();

      expect(denied.status).toBe(401);
      expect(deniedBody).toEqual({ error: "Unauthorized" });
      expectSanitized(deniedBody, configDir);

      const allowed = await PUT(
        settingsRequest(
          {
            botToken: "123456:secret-token",
            chatId: "-100123456789",
          },
          { "x-aipanel-write-token": "secret-write-token" },
        ),
      );

      expect(allowed.status).toBe(200);
    });
  });
});

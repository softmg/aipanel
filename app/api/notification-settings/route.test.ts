import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/notification-settings/route";
import { getDefaultNotificationSettings, getNotificationSettingsPath } from "@/lib/notifications/settings";
import type { NotificationSettings } from "@/lib/notifications/schema";

const originalConfigDir = process.env.AIPANEL_CONFIG_DIR;

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-notification-api-"));
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

async function writeSettingsFile(configDir: string, content: string) {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getNotificationSettingsPath(), content, "utf8");
}

function settingsRequest(body: unknown) {
  return new Request("http://localhost/api/notification-settings", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function rawRequest(body: string) {
  return new Request("http://localhost/api/notification-settings", {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

function expectSanitized(body: unknown, configDir: string) {
  const raw = JSON.stringify(body);
  expect(raw).not.toContain("telegramBotToken");
  expect(raw).not.toContain("secret-token");
  expect(raw).not.toContain(configDir);
  expect(raw).not.toContain("notification-settings.json");
}

afterEach(() => {
  if (originalConfigDir) {
    process.env.AIPANEL_CONFIG_DIR = originalConfigDir;
  } else {
    delete process.env.AIPANEL_CONFIG_DIR;
  }
});

describe("GET /api/notification-settings", () => {
  it("returns defaults when the settings file is absent", async () => {
    await withTempConfigDir(async () => {
      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(getDefaultNotificationSettings());
    });
  });

  it("does not expose secret-looking fields or settings file paths", async () => {
    await withTempConfigDir(async (configDir) => {
      await writeSettingsFile(
        configDir,
        JSON.stringify({ ...getDefaultNotificationSettings(), telegramBotToken: "secret-token" }),
      );

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(getDefaultNotificationSettings());
      expectSanitized(body, configDir);
    });
  });
});

describe("PUT /api/notification-settings", () => {
  it("accepts, saves, and returns a valid full settings object", async () => {
    await withTempConfigDir(async (configDir) => {
      const settings = getDefaultNotificationSettings();
      settings.enabled = false;
      settings.channels.browser = false;
      settings.defaults.mainSessionInputTokens = 750000;
      settings.rules[0]!.kinds = ["question"];

      const response = await PUT(settingsRequest(settings));
      const body = await response.json();
      const saved = JSON.parse(await fs.readFile(getNotificationSettingsPath(), "utf8"));

      expect(response.status).toBe(200);
      expect(body).toEqual(settings);
      expect(saved).toEqual(settings);
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

  it("rejects invalid schema with 400", async () => {
    await withTempConfigDir(async (configDir) => {
      const response = await PUT(settingsRequest({ enabled: "yes" }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Invalid notification settings" });
      expectSanitized(body, configDir);
    });
  });

  it("rejects unknown top-level secret fields with 400", async () => {
    await withTempConfigDir(async (configDir) => {
      const unsafeSettings = {
        ...getDefaultNotificationSettings(),
        telegramBotToken: "secret-token",
      } as unknown as NotificationSettings;

      const response = await PUT(settingsRequest(unsafeSettings));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: "Invalid notification settings" });
      expectSanitized(body, configDir);
    });
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { notificationSettingsSchema } from "@/lib/notifications/schema";
import {
  getDefaultNotificationSettings,
  getNotificationSettingsPath,
  loadNotificationSettings,
  saveNotificationSettings,
} from "@/lib/notifications/settings";
import type { NotificationSettings } from "@/lib/notifications/schema";

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-notification-settings-"));

  try {
    await run(configDir);
  } finally {
    await fs.rm(configDir, { recursive: true, force: true });
  }
}

async function writeSettingsFile(configDir: string, content: string) {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getNotificationSettingsPath({ configDir }), content, "utf8");
}

describe("notification settings", () => {
  it("parses default settings successfully", () => {
    expect(notificationSettingsSchema.safeParse(getDefaultNotificationSettings()).success).toBe(true);
  });

  it("returns all four notification kinds in the default global rule", () => {
    const settings = getDefaultNotificationSettings();
    expect(settings.rules[0]).toMatchObject({ id: "default-global", scope: "global" });
    expect(settings.rules[0]?.kinds).toEqual(["question", "permission", "task", "alert"]);
  });

  it("enables in-app and browser channels while disabling telegram and macos by default", () => {
    expect(getDefaultNotificationSettings().channels).toEqual({
      inApp: true,
      browser: true,
      telegram: false,
      macos: false,
    });
  });

  it("sets the default main session input token threshold", () => {
    expect(getDefaultNotificationSettings().defaults.mainSessionInputTokens).toBe(500000);
  });

  it("returns fresh default settings objects", () => {
    const first = getDefaultNotificationSettings();
    first.channels.browser = false;
    first.rules[0]!.kinds.pop();

    const second = getDefaultNotificationSettings();
    expect(second.channels.browser).toBe(true);
    expect(second.rules[0]?.kinds).toEqual(["question", "permission", "task", "alert"]);
  });

  it("returns defaults when the settings file is missing", async () => {
    await withTempConfigDir(async (configDir) => {
      await expect(loadNotificationSettings({ configDir })).resolves.toEqual(getDefaultNotificationSettings());
    });
  });

  it("writes a valid settings file", async () => {
    await withTempConfigDir(async (configDir) => {
      await saveNotificationSettings(getDefaultNotificationSettings(), { configDir });

      const raw = await fs.readFile(getNotificationSettingsPath({ configDir }), "utf8");
      expect(raw).toContain('\n  "enabled": true');
      expect(notificationSettingsSchema.safeParse(JSON.parse(raw)).success).toBe(true);
    });
  });

  it("round-trips a saved valid settings object", async () => {
    await withTempConfigDir(async (configDir) => {
      const settings = getDefaultNotificationSettings();
      settings.enabled = false;
      settings.channels.browser = false;
      settings.defaults.mainSessionInputTokens = 750000;
      settings.rules[0]!.kinds = ["question"];

      await saveNotificationSettings(settings, { configDir });

      await expect(loadNotificationSettings({ configDir })).resolves.toEqual(settings);
    });
  });

  it("falls back safely to defaults for invalid JSON", async () => {
    await withTempConfigDir(async (configDir) => {
      await writeSettingsFile(configDir, "{");

      await expect(loadNotificationSettings({ configDir })).resolves.toEqual(getDefaultNotificationSettings());
    });
  });

  it("falls back safely to defaults for an invalid schema", async () => {
    await withTempConfigDir(async (configDir) => {
      await writeSettingsFile(configDir, JSON.stringify({ enabled: "yes" }));

      await expect(loadNotificationSettings({ configDir })).resolves.toEqual(getDefaultNotificationSettings());
    });
  });

  it("rejects secret-looking top-level fields", () => {
    const unsafeSettings = {
      ...getDefaultNotificationSettings(),
      telegramBotToken: "secret-token",
    };

    expect(notificationSettingsSchema.safeParse(unsafeSettings).success).toBe(false);
  });

  it("does not write telegram bot tokens to settings JSON", async () => {
    await withTempConfigDir(async (configDir) => {
      const unsafeSettings = {
        ...getDefaultNotificationSettings(),
        telegramBotToken: "secret-token",
      } as unknown as NotificationSettings;

      await expect(saveNotificationSettings(unsafeSettings, { configDir })).rejects.toThrow();
      await saveNotificationSettings(getDefaultNotificationSettings(), { configDir });

      const raw = await fs.readFile(getNotificationSettingsPath({ configDir }), "utf8");
      expect(raw).not.toContain("telegramBotToken");
      expect(raw).not.toContain("secret-token");
    });
  });
});

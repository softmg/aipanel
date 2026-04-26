import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getNotificationSecretsPath,
  getTelegramSafeStatus,
  loadNotificationSecrets,
  saveNotificationSecrets,
} from "@/lib/notifications/secrets";

async function withTempConfigDir(run: (configDir: string) => Promise<void>) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-notification-secrets-"));

  try {
    await run(configDir);
  } finally {
    await fs.rm(configDir, { recursive: true, force: true });
  }
}

describe("notification secrets", () => {
  it("returns empty object when the secrets file is missing", async () => {
    await withTempConfigDir(async (configDir) => {
      await expect(loadNotificationSecrets({ configDir })).resolves.toEqual({});
    });
  });

  it("falls back safely to empty object for invalid JSON", async () => {
    await withTempConfigDir(async (configDir) => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(getNotificationSecretsPath({ configDir }), "{", "utf8");

      await expect(loadNotificationSecrets({ configDir })).resolves.toEqual({});
    });
  });

  it("falls back safely to empty object for invalid schema", async () => {
    await withTempConfigDir(async (configDir) => {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(getNotificationSecretsPath({ configDir }), JSON.stringify({ telegramChatId: 123 }), "utf8");

      await expect(loadNotificationSecrets({ configDir })).resolves.toEqual({});
    });
  });

  it("round-trips a saved valid secrets object", async () => {
    await withTempConfigDir(async (configDir) => {
      const secrets = {
        telegramBotToken: "123456:ABC-token",
        telegramChatId: "-100123456789",
      };

      await saveNotificationSecrets(secrets, { configDir });
      await expect(loadNotificationSecrets({ configDir })).resolves.toEqual(secrets);
    });
  });

  it("writes pretty JSON with trailing newline", async () => {
    await withTempConfigDir(async (configDir) => {
      await saveNotificationSecrets(
        {
          telegramBotToken: "123456:ABC-token",
          telegramChatId: "-100123456789",
        },
        { configDir },
      );

      const raw = await fs.readFile(getNotificationSecretsPath({ configDir }), "utf8");
      expect(raw).toContain('\n  "telegramBotToken": "123456:ABC-token"');
      expect(raw.endsWith("\n")).toBe(true);
    });
  });

  it("returns safe status without exposing token", () => {
    expect(
      getTelegramSafeStatus({
        telegramBotToken: "123456:ABC-token",
        telegramChatId: "-100123456789",
      }),
    ).toEqual({
      configured: true,
      botTokenConfigured: true,
      chatId: "-100123456789",
    });

    expect(getTelegramSafeStatus({ telegramBotToken: "   " })).toEqual({
      configured: false,
      botTokenConfigured: false,
    });
  });

  it("respects AIPANEL_CONFIG_DIR override", async () => {
    await withTempConfigDir(async (configDir) => {
      const previous = process.env.AIPANEL_CONFIG_DIR;
      process.env.AIPANEL_CONFIG_DIR = configDir;

      try {
        await saveNotificationSecrets({ telegramChatId: "123" });
        await expect(loadNotificationSecrets()).resolves.toEqual({ telegramChatId: "123" });
      } finally {
        if (previous) {
          process.env.AIPANEL_CONFIG_DIR = previous;
        } else {
          delete process.env.AIPANEL_CONFIG_DIR;
        }
      }
    });
  });

  it("uses a default path outside repository when no override is provided", () => {
    const previous = process.env.AIPANEL_CONFIG_DIR;
    delete process.env.AIPANEL_CONFIG_DIR;

    try {
      const defaultPath = getNotificationSecretsPath();
      expect(defaultPath).toContain(path.join(os.homedir(), ".aipanel"));
      expect(defaultPath).toContain("notification-secrets.json");
      expect(defaultPath.startsWith("/Users/fenix007/projects/ai/aipanel")).toBe(false);
    } finally {
      if (previous) {
        process.env.AIPANEL_CONFIG_DIR = previous;
      }
    }
  });
});

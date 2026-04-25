import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  notificationSettingsSchema,
  type NotificationSettings,
} from "@/lib/notifications/schema";

const SETTINGS_FILE_NAME = "notification-settings.json";
const DEFAULT_CONFIG_DIR_NAME = ".aipanel";

export type NotificationSettingsOptions = {
  configDir?: string;
};

export function getDefaultNotificationSettings(): NotificationSettings {
  return {
    enabled: true,
    channels: {
      inApp: true,
      browser: true,
      telegram: false,
      macos: false,
    },
    defaults: {
      mainSessionInputTokens: 500000,
      suppressBrowserWhenVisible: true,
      rateLimit: {
        max: 3,
        windowSeconds: 10,
      },
    },
    rules: [
      {
        id: "default-global",
        scope: "global",
        enabled: true,
        kinds: ["question", "permission", "task", "alert"],
        channels: {
          inApp: true,
          browser: true,
          telegram: false,
          macos: false,
        },
      },
    ],
  };
}

export function getNotificationSettingsPath(options: NotificationSettingsOptions = {}): string {
  const configDir = options.configDir ?? path.join(os.homedir(), DEFAULT_CONFIG_DIR_NAME);
  return path.join(configDir, SETTINGS_FILE_NAME);
}

export async function loadNotificationSettings(
  options: NotificationSettingsOptions = {},
): Promise<NotificationSettings> {
  let raw: string;

  try {
    raw = await fs.readFile(getNotificationSettingsPath(options), "utf8");
  } catch {
    return getDefaultNotificationSettings();
  }

  try {
    return notificationSettingsSchema.parse(JSON.parse(raw));
  } catch {
    return getDefaultNotificationSettings();
  }
}

export async function saveNotificationSettings(
  settings: NotificationSettings,
  options: NotificationSettingsOptions = {},
): Promise<void> {
  const parsed = notificationSettingsSchema.parse(settings);
  const settingsPath = getNotificationSettingsPath(options);

  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    throw new Error("Unable to save notification settings.");
  }
}

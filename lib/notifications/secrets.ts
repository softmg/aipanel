import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const SECRETS_FILE_NAME = "notification-secrets.json";
const DEFAULT_CONFIG_DIR_NAME = ".aipanel";
const CONFIG_DIR_ENV = "AIPANEL_CONFIG_DIR";

export const notificationSecretsSchema = z
  .object({
    telegramBotToken: z.string().optional(),
    telegramChatId: z.string().optional(),
  })
  .strict();

export type NotificationSecrets = z.infer<typeof notificationSecretsSchema>;

export type TelegramSafeStatus = {
  configured: boolean;
  botTokenConfigured: boolean;
  chatId?: string;
};

export type NotificationSecretsOptions = {
  configDir?: string;
};

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function getNotificationSecretsPath(options: NotificationSecretsOptions = {}): string {
  const configDir = options.configDir ?? process.env[CONFIG_DIR_ENV] ?? path.join(os.homedir(), DEFAULT_CONFIG_DIR_NAME);
  return path.join(configDir, SECRETS_FILE_NAME);
}

export async function loadNotificationSecrets(
  options: NotificationSecretsOptions = {},
): Promise<NotificationSecrets> {
  let raw: string;

  try {
    raw = await fs.readFile(getNotificationSecretsPath(options), "utf8");
  } catch {
    return {};
  }

  try {
    return notificationSecretsSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveNotificationSecrets(
  secrets: NotificationSecrets,
  options: NotificationSecretsOptions = {},
): Promise<void> {
  const parsed = notificationSecretsSchema.parse(secrets);
  const secretsPath = getNotificationSecretsPath(options);

  try {
    await fs.mkdir(path.dirname(secretsPath), { recursive: true });
    await fs.writeFile(secretsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    throw new Error("Unable to save notification secrets.");
  }
}

export function getTelegramSafeStatus(secrets: NotificationSecrets): TelegramSafeStatus {
  const botTokenConfigured = Boolean(normalizeNonEmpty(secrets.telegramBotToken));
  const chatId = normalizeNonEmpty(secrets.telegramChatId);

  return {
    configured: botTokenConfigured && Boolean(chatId),
    botTokenConfigured,
    ...(chatId ? { chatId } : {}),
  };
}

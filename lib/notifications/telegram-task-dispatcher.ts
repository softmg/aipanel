import { getGlobalNotificationRule } from "@/lib/notifications/global-settings";
import { sendTelegramNotification, type TelegramNotificationConfig } from "@/lib/notifications/channels/telegram";
import {
  hasSuccessfulDelivery,
  recordDeliveryAttempt,
  recordDeliveryFailure,
  recordDeliverySuccess,
  type DeliveryLogRecordInput,
} from "@/lib/notifications/delivery-log";
import { loadNotificationSecrets } from "@/lib/notifications/secrets";
import { loadNotificationSettings } from "@/lib/notifications/settings";
import { isTaskCompletionNotification } from "@/lib/notifications/task-completion";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

export type TelegramTaskDispatchSummary = {
  considered: number;
  eligible: number;
  sent: number;
  skipped: number;
  failed: number;
};

export type TelegramTaskDispatcherOptions = {
  configDir?: string;
  sender?: (notification: ClaudeNotification, config: TelegramNotificationConfig) => Promise<void>;
  now?: Date;
  ruleId?: string;
};

const DEFAULT_RULE_ID = "task-completion";

function createSummary(): TelegramTaskDispatchSummary {
  return {
    considered: 0,
    eligible: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };
}

function buildDeliveryInput(
  notification: ClaudeNotification,
  options: TelegramTaskDispatcherOptions,
): DeliveryLogRecordInput {
  return {
    channel: "telegram",
    notificationId: notification.id,
    projectSlug: notification.projectSlug,
    sessionId: notification.sessionId,
    ruleId: options.ruleId ?? DEFAULT_RULE_ID,
    now: options.now,
  };
}

export async function dispatchTelegramTaskCompletionNotifications(
  notifications: ClaudeNotification[],
  options: TelegramTaskDispatcherOptions = {},
): Promise<TelegramTaskDispatchSummary> {
  const summary = createSummary();
  summary.considered = notifications.length;

  const settings = await loadNotificationSettings({ configDir: options.configDir });
  if (!settings.enabled) {
    summary.skipped = notifications.length;
    return summary;
  }

  const globalRule = getGlobalNotificationRule(settings);
  const telegramEnabled = settings.channels.telegram && Boolean(globalRule?.channels.telegram);
  if (!telegramEnabled) {
    summary.skipped = notifications.length;
    return summary;
  }

  const secrets = await loadNotificationSecrets({ configDir: options.configDir });
  const botToken = secrets.telegramBotToken?.trim();
  const chatId = secrets.telegramChatId?.trim();

  if (!botToken || !chatId) {
    summary.skipped = notifications.length;
    return summary;
  }

  const sender = options.sender ?? sendTelegramNotification;

  for (const notification of notifications) {
    if (!isTaskCompletionNotification(notification)) {
      summary.skipped += 1;
      continue;
    }

    summary.eligible += 1;

    const deliveryInput = buildDeliveryInput(notification, options);
    if (hasSuccessfulDelivery(deliveryInput, { configDir: options.configDir })) {
      summary.skipped += 1;
      continue;
    }

    recordDeliveryAttempt(deliveryInput, { configDir: options.configDir });

    try {
      await sender(notification, { botToken, chatId });
      recordDeliverySuccess(deliveryInput, { configDir: options.configDir });
      summary.sent += 1;
    } catch (error) {
      recordDeliveryFailure(deliveryInput, error, { configDir: options.configDir });
      summary.failed += 1;
    }
  }

  return summary;
}

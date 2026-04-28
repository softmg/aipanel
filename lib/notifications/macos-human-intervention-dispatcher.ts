import {
  sendMacOSNativeNotification,
  type MacOSNotificationConfig,
  type MacOSNotificationResult,
} from "@/lib/notifications/channels/macos";
import {
  hasSuccessfulDelivery,
  recordDeliveryAttempt,
  recordDeliveryFailure,
  recordDeliverySuccess,
  type DeliveryLogRecordInput,
} from "@/lib/notifications/delivery-log";
import { isNotificationSelectedForChannel } from "@/lib/notifications/events";
import { getGlobalNotificationRule } from "@/lib/notifications/global-settings";
import { loadNotificationSettings } from "@/lib/notifications/settings";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

export type MacOSHumanInterventionDispatchSummary = {
  considered: number;
  eligible: number;
  sent: number;
  skipped: number;
  failed: number;
};

export type MacOSHumanInterventionDispatcherOptions = {
  configDir?: string;
  sender?: (notification: ClaudeNotification, config: MacOSNotificationConfig) => Promise<MacOSNotificationResult>;
  now?: Date;
  ruleId?: string;
  dryRun?: boolean;
};

const DEFAULT_RULE_ID = "human-intervention";

function createSummary(): MacOSHumanInterventionDispatchSummary {
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
  options: MacOSHumanInterventionDispatcherOptions,
): DeliveryLogRecordInput {
  return {
    channel: "macos",
    notificationId: notification.id,
    projectSlug: notification.projectSlug,
    sessionId: notification.sessionId,
    ruleId: options.ruleId ?? DEFAULT_RULE_ID,
    now: options.now,
  };
}

export async function dispatchMacOSHumanInterventionNotifications(
  notifications: ClaudeNotification[],
  options: MacOSHumanInterventionDispatcherOptions = {},
): Promise<MacOSHumanInterventionDispatchSummary> {
  const summary = createSummary();
  summary.considered = notifications.length;

  const settings = await loadNotificationSettings({ configDir: options.configDir });
  if (!settings.enabled) {
    summary.skipped = notifications.length;
    return summary;
  }

  const globalRule = getGlobalNotificationRule(settings);
  const macosEnabled = settings.channels.macos && Boolean(globalRule?.channels.macos);
  if (!macosEnabled) {
    summary.skipped = notifications.length;
    return summary;
  }

  const sender = options.sender ?? sendMacOSNativeNotification;

  for (const notification of notifications) {
    if (!isNotificationSelectedForChannel(settings.channelEvents, "macos", notification)) {
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
      const result = await sender(notification, {
        enabled: true,
        mode: "script",
        dryRun: options.dryRun,
      });

      if (result.ok) {
        recordDeliverySuccess(deliveryInput, { configDir: options.configDir });
        summary.sent += 1;
        continue;
      }

      if ("reason" in result) {
        recordDeliveryFailure(deliveryInput, result.reason, { configDir: options.configDir });
        summary.skipped += 1;
        continue;
      }

      recordDeliveryFailure(deliveryInput, result.error, { configDir: options.configDir });
      summary.failed += 1;
    } catch (error) {
      recordDeliveryFailure(deliveryInput, error, { configDir: options.configDir });
      summary.failed += 1;
    }
  }

  return summary;
}

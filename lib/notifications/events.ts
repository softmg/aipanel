import { z } from "zod";
import { isTaskCompletionNotification } from "@/lib/notifications/task-completion";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

export const notificationEventKeySchema = z.enum([
  "question.ask_user",
  "permission.tool_request",
  "task.ready_for_review",
  "task.update",
  "alert.context_threshold",
  "error.api_failure",
]);

export const notificationEventGroupSchema = z.enum(["action_required", "updates", "alerts", "failures"]);

export type NotificationEventKey = z.infer<typeof notificationEventKeySchema>;
export type NotificationEventGroup = z.infer<typeof notificationEventGroupSchema>;
export type NotificationDeliveryChannel = "inApp" | "browser" | "telegram" | "macos";

export type NotificationChannelEventSelections = Record<NotificationDeliveryChannel, NotificationEventKey[]>;

export const ACTION_REQUIRED_EVENT_KEYS: NotificationEventKey[] = [
  "question.ask_user",
  "permission.tool_request",
  "task.ready_for_review",
];

export const FAILURE_EVENT_KEYS: NotificationEventKey[] = ["error.api_failure"];

export const DEFAULT_EXTERNAL_EVENT_KEYS: NotificationEventKey[] = [
  ...ACTION_REQUIRED_EVENT_KEYS,
  ...FAILURE_EVENT_KEYS,
];

export const NOTIFICATION_EVENT_GROUPS: Record<NotificationEventGroup, NotificationEventKey[]> = {
  action_required: ACTION_REQUIRED_EVENT_KEYS,
  updates: ["task.update"],
  alerts: ["alert.context_threshold"],
  failures: FAILURE_EVENT_KEYS,
};

const CHANNELS: NotificationDeliveryChannel[] = ["inApp", "browser", "telegram", "macos"];

export const ALL_NOTIFICATION_EVENT_KEYS: NotificationEventKey[] = [
  ...ACTION_REQUIRED_EVENT_KEYS,
  "task.update",
  "alert.context_threshold",
  ...FAILURE_EVENT_KEYS,
];

function orderAndUnique(keys: NotificationEventKey[]): NotificationEventKey[] {
  const selected = new Set(keys);
  return ALL_NOTIFICATION_EVENT_KEYS.filter((key) => selected.has(key));
}

function parseEventKeys(value: unknown): NotificationEventKey[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed = value.flatMap((entry) => {
    const result = notificationEventKeySchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });

  return orderAndUnique(parsed);
}

function hasExactKeys(actual: NotificationEventKey[], expected: NotificationEventKey[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  const expectedSet = new Set(expected);
  return actual.every((key) => expectedSet.has(key));
}

export function getDefaultChannelEventSelections(): NotificationChannelEventSelections {
  return {
    inApp: [...ALL_NOTIFICATION_EVENT_KEYS],
    browser: [...DEFAULT_EXTERNAL_EVENT_KEYS],
    telegram: [...DEFAULT_EXTERNAL_EVENT_KEYS],
    macos: [...DEFAULT_EXTERNAL_EVENT_KEYS],
  };
}

export function normalizeChannelEventSelections(
  value: unknown,
  options: { appendApiFailureForLegacyExternalDefault?: boolean } = {},
): NotificationChannelEventSelections {
  const defaults = getDefaultChannelEventSelections();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const raw = value as Partial<Record<NotificationDeliveryChannel, unknown>>;

  const normalized: NotificationChannelEventSelections = {
    inApp: parseEventKeys(raw.inApp),
    browser: parseEventKeys(raw.browser),
    telegram: parseEventKeys(raw.telegram),
    macos: parseEventKeys(raw.macos),
  };

  for (const channel of CHANNELS) {
    if (normalized[channel].length === 0) {
      normalized[channel] = [...defaults[channel]];
    }
  }

  if (options.appendApiFailureForLegacyExternalDefault) {
    for (const channel of ["browser", "telegram", "macos"] as const) {
      if (hasExactKeys(normalized[channel], ACTION_REQUIRED_EVENT_KEYS)) {
        normalized[channel] = orderAndUnique([...normalized[channel], "error.api_failure"]);
      }
    }
  }

  return normalized;
}

export function getNotificationEventKey(notification: ClaudeNotification): NotificationEventKey {
  if (notification.kind === "question") {
    return "question.ask_user";
  }

  if (notification.kind === "permission") {
    return "permission.tool_request";
  }

  if (notification.kind === "task") {
    return isTaskCompletionNotification(notification) ? "task.ready_for_review" : "task.update";
  }

  if ((notification.status ?? "").trim().toLowerCase() === "api_failure") {
    return "error.api_failure";
  }

  return "alert.context_threshold";
}

export function isNotificationSelectedForChannel(
  channelEvents: NotificationChannelEventSelections | undefined,
  channel: NotificationDeliveryChannel,
  notificationOrEvent: ClaudeNotification | NotificationEventKey,
): boolean {
  const eventKey = typeof notificationOrEvent === "string"
    ? notificationOrEvent
    : getNotificationEventKey(notificationOrEvent);
  const normalized = normalizeChannelEventSelections(channelEvents);
  return normalized[channel].includes(eventKey);
}

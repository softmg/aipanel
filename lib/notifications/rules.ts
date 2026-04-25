import type {
  NotificationChannel,
  NotificationRule,
  NotificationSettings,
} from "@/lib/notifications/schema";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

const CHANNEL_ORDER: NotificationChannel[] = ["inApp", "browser", "telegram", "macos"];
const QUIET_HOURS_SUPPRESSED_CHANNELS = new Set<NotificationChannel>(["browser", "telegram", "macos"]);

export type MatchedNotificationRule = {
  rule: NotificationRule;
  channels: NotificationChannel[];
  suppressedChannels?: Array<{
    channel: NotificationChannel;
    reason: string;
  }>;
};

export type MatchNotificationRulesOptions = {
  now?: Date;
};

type QuietHours = NonNullable<NotificationRule["quietHours"]>;

export function isRuleKindMatch(rule: NotificationRule, notification: ClaudeNotification): boolean {
  return rule.kinds.includes(notification.kind);
}

export function isRuleScopeMatch(rule: NotificationRule, notification: ClaudeNotification): boolean {
  if (rule.scope === "global") {
    return true;
  }

  if (rule.scope === "project") {
    return Boolean(notification.projectSlug) && rule.projectSlug === notification.projectSlug;
  }

  if ("projectSlug" in rule && rule.projectSlug !== undefined && rule.projectSlug !== notification.projectSlug) {
    return false;
  }

  return Boolean(notification.sessionId) && rule.sessionId === notification.sessionId;
}

export function getEnabledRuleChannels(
  rule: NotificationRule,
  settings: NotificationSettings,
): NotificationChannel[] {
  return CHANNEL_ORDER.filter((channel) => rule.channels[channel] && settings.channels[channel]);
}

function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function isWithinQuietHours(quietHours: QuietHours | undefined, now: Date): boolean {
  if (!quietHours?.enabled) {
    return false;
  }

  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);
  if (start === null || end === null || start === end) {
    return false;
  }

  const current = now.getHours() * 60 + now.getMinutes();
  if (start < end) {
    return current >= start && current < end;
  }

  return current >= start || current < end;
}

export function applyQuietHours(
  channels: NotificationChannel[],
  quietHours: QuietHours | undefined,
  now: Date,
): Pick<MatchedNotificationRule, "channels" | "suppressedChannels"> {
  if (!isWithinQuietHours(quietHours, now)) {
    return { channels };
  }

  const remainingChannels: NotificationChannel[] = [];
  const suppressedChannels: MatchedNotificationRule["suppressedChannels"] = [];

  for (const channel of channels) {
    if (QUIET_HOURS_SUPPRESSED_CHANNELS.has(channel)) {
      suppressedChannels.push({ channel, reason: "quiet-hours" });
    } else {
      remainingChannels.push(channel);
    }
  }

  return suppressedChannels.length > 0
    ? { channels: remainingChannels, suppressedChannels }
    : { channels: remainingChannels };
}

export function matchNotificationRules(
  notification: ClaudeNotification,
  settings: NotificationSettings,
  options: MatchNotificationRulesOptions = {},
): MatchedNotificationRule[] {
  if (!settings.enabled) {
    return [];
  }

  const now = options.now ?? new Date();
  const matches: MatchedNotificationRule[] = [];

  for (const rule of settings.rules) {
    if (!rule.enabled || !isRuleKindMatch(rule, notification) || !isRuleScopeMatch(rule, notification)) {
      continue;
    }

    const channels = getEnabledRuleChannels(rule, settings);
    if (channels.length === 0) {
      continue;
    }

    const quietHoursResult = applyQuietHours(channels, rule.quietHours, now);
    if (quietHoursResult.channels.length === 0) {
      continue;
    }

    matches.push({
      rule,
      ...quietHoursResult,
    });
  }

  return matches;
}

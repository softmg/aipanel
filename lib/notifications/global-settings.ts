import {
  notificationSettingsSchema,
  type NotificationKind,
  type NotificationRule,
  type NotificationSettings,
} from "@/lib/notifications/schema";

export const DEFAULT_GLOBAL_NOTIFICATION_RULE_ID = "default-global";

export type GlobalNotificationSettingsInput = {
  enabled: boolean;
  kinds: NotificationKind[];
  contextTokensThreshold: number;
  channels: NotificationSettings["channels"];
};

type GlobalNotificationRule = Extract<NotificationRule, { scope: "global" }>;

const DEFAULT_NOTIFICATION_KINDS: NotificationKind[] = ["question", "permission", "task", "alert"];

export function getGlobalNotificationRule(settings: NotificationSettings): GlobalNotificationRule | null {
  return (
    settings.rules.find((rule): rule is GlobalNotificationRule => (
      rule.scope === "global" && rule.id === DEFAULT_GLOBAL_NOTIFICATION_RULE_ID
    )) ??
    settings.rules.find((rule): rule is GlobalNotificationRule => rule.scope === "global") ??
    null
  );
}

export function ensureGlobalNotificationRule(settings: NotificationSettings): NotificationSettings {
  const selectedRule = getGlobalNotificationRule(settings);
  const defaultRule = selectedRule
    ? cloneGlobalRule(selectedRule, {
        id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID,
        thresholds: selectedRule.thresholds ?? { contextTokens: settings.defaults.contextTokensThreshold },
      })
    : createDefaultGlobalRule(settings);

  const rules = selectedRule
    ? [
        defaultRule,
        ...settings.rules
          .filter((rule) => rule !== selectedRule && !(rule.scope === "global" && rule.id === DEFAULT_GLOBAL_NOTIFICATION_RULE_ID))
          .map(cloneRule),
      ]
    : [defaultRule, ...settings.rules.map(cloneRule)];

  return parseSettings({
    enabled: settings.enabled,
    channels: cloneChannels(settings.channels),
    defaults: cloneDefaults(settings.defaults),
    rules,
  });
}

export function updateGlobalNotificationSettings(
  settings: NotificationSettings,
  input: GlobalNotificationSettingsInput,
): NotificationSettings {
  const selectedRule = getGlobalNotificationRule(settings);
  const defaultRule = selectedRule
    ? cloneGlobalRule(selectedRule, {
        id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID,
        enabled: true,
        kinds: [...input.kinds],
        thresholds: { contextTokens: input.contextTokensThreshold },
        channels: cloneChannels(input.channels),
      })
    : {
        ...createDefaultGlobalRule({
          channels: input.channels,
          defaults: {
            ...settings.defaults,
            contextTokensThreshold: input.contextTokensThreshold,
          },
        }),
        kinds: [...input.kinds],
      };

  return parseSettings({
    enabled: input.enabled,
    channels: cloneChannels(input.channels),
    defaults: cloneDefaults(settings.defaults, input.contextTokensThreshold),
    rules: [defaultRule],
  });
}

export function normalizeGlobalNotificationSettings(settings: NotificationSettings): NotificationSettings {
  const selectedRule = getGlobalNotificationRule(settings);
  const channels = mergeChannels(settings.channels, selectedRule?.channels);
  const defaultRule = selectedRule
    ? cloneGlobalRule(selectedRule, {
        id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID,
        enabled: true,
        thresholds: { contextTokens: settings.defaults.contextTokensThreshold },
        channels,
      })
    : createDefaultGlobalRule({ ...settings, channels });

  return parseSettings({
    enabled: settings.enabled,
    channels,
    defaults: cloneDefaults(settings.defaults),
    rules: [defaultRule],
  });
}

function createDefaultGlobalRule(settings: Pick<NotificationSettings, "channels" | "defaults">): GlobalNotificationRule {
  return {
    id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID,
    scope: "global",
    enabled: true,
    kinds: [...DEFAULT_NOTIFICATION_KINDS],
    thresholds: { contextTokens: settings.defaults.contextTokensThreshold },
    channels: cloneChannels(settings.channels),
  };
}

function cloneDefaults(
  defaults: NotificationSettings["defaults"],
  contextTokensThreshold = defaults.contextTokensThreshold,
): NotificationSettings["defaults"] {
  return {
    contextTokensThreshold,
    suppressBrowserWhenVisible: defaults.suppressBrowserWhenVisible,
    rateLimit: {
      max: defaults.rateLimit.max,
      windowSeconds: defaults.rateLimit.windowSeconds,
    },
  };
}

function cloneRule(rule: NotificationRule): NotificationRule {
  if (rule.scope === "global") {
    return cloneGlobalRule(rule);
  }

  const base = {
    id: rule.id,
    enabled: rule.enabled,
    kinds: [...rule.kinds],
    thresholds: rule.thresholds ? { ...rule.thresholds } : undefined,
    channels: cloneChannels(rule.channels),
    quietHours: rule.quietHours ? { ...rule.quietHours } : undefined,
    rateLimit: rule.rateLimit ? { ...rule.rateLimit } : undefined,
  };

  if (rule.scope === "project") {
    return {
      ...base,
      scope: "project",
      projectSlug: rule.projectSlug,
    };
  }

  return {
    ...base,
    scope: "session",
    sessionId: rule.sessionId,
    projectSlug: rule.projectSlug,
  };
}

function cloneGlobalRule(
  rule: GlobalNotificationRule,
  overrides: Partial<GlobalNotificationRule> = {},
): GlobalNotificationRule {
  return {
    id: overrides.id ?? rule.id,
    scope: "global",
    enabled: overrides.enabled ?? rule.enabled,
    kinds: overrides.kinds ? [...overrides.kinds] : [...rule.kinds],
    thresholds: overrides.thresholds
      ? { ...overrides.thresholds }
      : rule.thresholds
        ? { ...rule.thresholds }
        : undefined,
    channels: cloneChannels(overrides.channels ?? rule.channels),
    quietHours: overrides.quietHours
      ? { ...overrides.quietHours }
      : rule.quietHours
        ? { ...rule.quietHours }
        : undefined,
    rateLimit: overrides.rateLimit
      ? { ...overrides.rateLimit }
      : rule.rateLimit
        ? { ...rule.rateLimit }
        : undefined,
  };
}

function cloneChannels(channels: NotificationSettings["channels"]): NotificationSettings["channels"] {
  return {
    inApp: channels.inApp,
    browser: channels.browser,
    telegram: channels.telegram,
    macos: channels.macos,
  };
}

function mergeChannels(
  settingsChannels: NotificationSettings["channels"],
  ruleChannels?: NotificationSettings["channels"],
): NotificationSettings["channels"] {
  return {
    inApp: settingsChannels.inApp || Boolean(ruleChannels?.inApp),
    browser: settingsChannels.browser || Boolean(ruleChannels?.browser),
    telegram: settingsChannels.telegram || Boolean(ruleChannels?.telegram),
    macos: settingsChannels.macos || Boolean(ruleChannels?.macos),
  };
}

function parseSettings(settings: NotificationSettings): NotificationSettings {
  return notificationSettingsSchema.parse(settings);
}

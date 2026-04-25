import type {
  NotificationChannel,
  NotificationKind,
  NotificationRule,
  NotificationSettings,
} from "@/lib/notifications/schema";

const DEFAULT_NOTIFICATION_KINDS: NotificationKind[] = ["question", "permission", "task", "alert"];
const DEFAULT_NOTIFICATION_CHANNELS: Record<NotificationChannel, boolean> = {
  inApp: true,
  browser: true,
  telegram: false,
  macos: false,
};

type NotificationRuleChannels = NotificationRule["channels"];

type ProjectNotificationRuleInput = {
  projectSlug: string;
  kinds: NotificationKind[];
  channels: NotificationRuleChannels;
  contextTokensThreshold: number;
};

type SessionNotificationRuleInput = ProjectNotificationRuleInput & {
  sessionId: string;
};

type ProjectRule = Extract<NotificationRule, { scope: "project" }>;
type SessionRule = Extract<NotificationRule, { scope: "session" }>;

export function makeProjectRuleId(projectSlug: string): string {
  return `project:${projectSlug}`;
}

export function makeSessionRuleId(projectSlug: string, sessionId: string): string {
  return `session:${projectSlug}:${encodeURIComponent(sessionId)}`;
}

export function getProjectNotificationRule(
  settings: NotificationSettings,
  projectSlug: string,
): ProjectRule | undefined {
  const ruleId = makeProjectRuleId(projectSlug);
  return settings.rules.find((rule): rule is ProjectRule => (
    rule.scope === "project" && (rule.id === ruleId || rule.projectSlug === projectSlug)
  ));
}

export function getSessionNotificationRule(
  settings: NotificationSettings,
  projectSlug: string,
  sessionId: string,
): SessionRule | undefined {
  const ruleId = makeSessionRuleId(projectSlug, sessionId);
  return settings.rules.find((rule): rule is SessionRule => (
    rule.scope === "session" && (
      rule.id === ruleId || (rule.sessionId === sessionId && rule.projectSlug === projectSlug)
    )
  ));
}

export function upsertProjectNotificationRule(
  settings: NotificationSettings,
  input: ProjectNotificationRuleInput,
): NotificationSettings {
  const nextRule: ProjectRule = {
    id: makeProjectRuleId(input.projectSlug),
    scope: "project",
    projectSlug: input.projectSlug,
    enabled: true,
    kinds: [...input.kinds],
    thresholds: { contextTokens: input.contextTokensThreshold },
    channels: { ...input.channels },
  };

  return upsertRule(settings, nextRule, (rule) => (
    rule.scope === "project" && (rule.id === nextRule.id || rule.projectSlug === input.projectSlug)
  ));
}

export function upsertSessionNotificationRule(
  settings: NotificationSettings,
  input: SessionNotificationRuleInput,
): NotificationSettings {
  const nextRule: SessionRule = {
    id: makeSessionRuleId(input.projectSlug, input.sessionId),
    scope: "session",
    projectSlug: input.projectSlug,
    sessionId: input.sessionId,
    enabled: true,
    kinds: [...input.kinds],
    thresholds: { contextTokens: input.contextTokensThreshold },
    channels: { ...input.channels },
  };

  return upsertRule(settings, nextRule, (rule) => (
    rule.scope === "session" && (
      rule.id === nextRule.id || (rule.sessionId === input.sessionId && rule.projectSlug === input.projectSlug)
    )
  ));
}

export function disableProjectNotificationRule(
  settings: NotificationSettings,
  projectSlug: string,
): NotificationSettings {
  const ruleId = makeProjectRuleId(projectSlug);
  return updateMatchingRule(settings, (rule) => (
    rule.scope === "project" && (rule.id === ruleId || rule.projectSlug === projectSlug)
  ));
}

export function disableSessionNotificationRule(
  settings: NotificationSettings,
  projectSlug: string,
  sessionId: string,
): NotificationSettings {
  const ruleId = makeSessionRuleId(projectSlug, sessionId);
  return updateMatchingRule(settings, (rule) => (
    rule.scope === "session" && (
      rule.id === ruleId || (rule.sessionId === sessionId && rule.projectSlug === projectSlug)
    )
  ));
}

export function getDefaultNotificationKinds(): NotificationKind[] {
  return [...DEFAULT_NOTIFICATION_KINDS];
}

export function getDefaultNotificationChannels(): NotificationRuleChannels {
  return { ...DEFAULT_NOTIFICATION_CHANNELS };
}

function upsertRule(
  settings: NotificationSettings,
  nextRule: NotificationRule,
  isMatch: (rule: NotificationRule) => boolean,
): NotificationSettings {
  let matched = false;
  const rules = settings.rules.map((rule) => {
    if (!isMatch(rule)) {
      return cloneRule(rule);
    }

    matched = true;
    return cloneRule(nextRule);
  });

  if (!matched) {
    rules.push(cloneRule(nextRule));
  }

  return cloneSettings(settings, rules);
}

function updateMatchingRule(
  settings: NotificationSettings,
  isMatch: (rule: NotificationRule) => boolean,
): NotificationSettings {
  const rules = settings.rules.map((rule) => (
    isMatch(rule) ? cloneRule({ ...rule, enabled: false }) : cloneRule(rule)
  ));

  return cloneSettings(settings, rules);
}

function cloneSettings(settings: NotificationSettings, rules: NotificationRule[]): NotificationSettings {
  return {
    ...settings,
    channels: { ...settings.channels },
    defaults: {
      ...settings.defaults,
      rateLimit: { ...settings.defaults.rateLimit },
    },
    rules,
  };
}

function cloneRule(rule: NotificationRule): NotificationRule {
  return {
    ...rule,
    kinds: [...rule.kinds],
    channels: { ...rule.channels },
    thresholds: rule.thresholds ? { ...rule.thresholds } : undefined,
    quietHours: rule.quietHours ? { ...rule.quietHours } : undefined,
    rateLimit: rule.rateLimit ? { ...rule.rateLimit } : undefined,
  } as NotificationRule;
}

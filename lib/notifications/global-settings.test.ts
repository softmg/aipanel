import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBAL_NOTIFICATION_RULE_ID,
  ensureGlobalNotificationRule,
  getGlobalNotificationRule,
  normalizeGlobalNotificationSettings,
  updateGlobalNotificationSettings,
} from "@/lib/notifications/global-settings";
import { getDefaultChannelEventSelections } from "@/lib/notifications/events";
import { notificationSettingsSchema, type NotificationRule, type NotificationSettings } from "@/lib/notifications/schema";
import { getDefaultNotificationSettings } from "@/lib/notifications/settings";

const allChannels = {
  inApp: true,
  browser: true,
  telegram: true,
  macos: true,
};

function globalRule(overrides: Partial<Extract<NotificationRule, { scope: "global" }>> = {}): Extract<NotificationRule, { scope: "global" }> {
  return {
    id: "global-custom",
    scope: "global",
    enabled: true,
    kinds: ["question"],
    thresholds: { contextTokens: 123000 },
    channels: { inApp: true, browser: false, telegram: false, macos: false },
    ...overrides,
  };
}

function projectRule(): Extract<NotificationRule, { scope: "project" }> {
  return {
    id: "project:alpha",
    scope: "project",
    projectSlug: "alpha",
    enabled: true,
    kinds: ["permission"],
    thresholds: { contextTokens: 222000 },
    channels: allChannels,
  };
}

function sessionRule(): Extract<NotificationRule, { scope: "session" }> {
  return {
    id: "session:alpha:session-1",
    scope: "session",
    projectSlug: "alpha",
    sessionId: "session-1",
    enabled: true,
    kinds: ["task"],
    thresholds: { contextTokens: 333000 },
    channels: allChannels,
  };
}

function settingsWithRules(rules: NotificationRule[], overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    ...getDefaultNotificationSettings(),
    channels: { inApp: true, browser: false, telegram: false, macos: false },
    rules,
    ...overrides,
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function inputBase() {
  return {
    channelEvents: getDefaultChannelEventSelections(),
  };
}

describe("global notification settings helpers", () => {
  it("getGlobalNotificationRule returns default-global first", () => {
    const fallback = globalRule({ id: "fallback-global" });
    const defaultGlobal = globalRule({ id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID, kinds: ["alert"] });

    expect(getGlobalNotificationRule(settingsWithRules([fallback, defaultGlobal]))).toEqual(defaultGlobal);
  });

  it("getGlobalNotificationRule returns the first global rule if default-global is missing", () => {
    const fallback = globalRule({ id: "fallback-global" });

    expect(getGlobalNotificationRule(settingsWithRules([projectRule(), fallback]))).toEqual(fallback);
  });

  it("getGlobalNotificationRule returns null when no global rule exists", () => {
    expect(getGlobalNotificationRule(settingsWithRules([projectRule(), sessionRule()]))).toBeNull();
  });

  it("ensureGlobalNotificationRule creates default-global if missing", () => {
    const result = ensureGlobalNotificationRule(settingsWithRules([]));

    expect(result.rules[0]).toMatchObject({
      id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID,
      scope: "global",
      enabled: true,
      kinds: ["question", "permission", "task", "alert"],
      thresholds: { contextTokens: result.defaults.contextTokensThreshold },
      channels: result.channels,
    });
  });

  it("ensureGlobalNotificationRule does not mutate input", () => {
    const input = settingsWithRules([globalRule()]);
    const snapshot = structuredClone(input);
    const result = ensureGlobalNotificationRule(input);

    expect(result).not.toBe(input);
    expect(result.rules).not.toBe(input.rules);
    expect(input).toEqual(snapshot);
  });

  it("updateGlobalNotificationSettings updates settings.enabled", () => {
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: false,
      kinds: ["question"],
      contextTokensThreshold: 500000,
      channels: allChannels,
    });

    expect(result.enabled).toBe(false);
  });

  it("updateGlobalNotificationSettings updates defaults.contextTokensThreshold", () => {
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: true,
      kinds: ["question"],
      contextTokensThreshold: 750000,
      channels: allChannels,
    });

    expect(result.defaults.contextTokensThreshold).toBe(750000);
  });

  it("updateGlobalNotificationSettings updates settings.channels", () => {
    const channels = { inApp: true, browser: false, telegram: true, macos: false };
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: true,
      kinds: ["question"],
      contextTokensThreshold: 500000,
      channels,
    });

    expect(result.channels).toEqual(channels);
  });

  it("updateGlobalNotificationSettings updates default-global kinds", () => {
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: true,
      kinds: ["permission", "alert"],
      contextTokensThreshold: 500000,
      channels: allChannels,
    });

    expect(getGlobalNotificationRule(result)?.kinds).toEqual(["permission", "alert"]);
  });

  it("updateGlobalNotificationSettings updates default-global thresholds.contextTokens", () => {
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: true,
      kinds: ["alert"],
      contextTokensThreshold: 820000,
      channels: allChannels,
    });

    expect(getGlobalNotificationRule(result)?.thresholds).toEqual({ contextTokens: 820000 });
  });

  it("updateGlobalNotificationSettings updates default-global channels", () => {
    const channels = { inApp: false, browser: true, telegram: true, macos: false };
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: true,
      kinds: ["task"],
      contextTokensThreshold: 500000,
      channels,
    });

    expect(getGlobalNotificationRule(result)?.channels).toEqual(channels);
  });

  it("helper-generated settings parse with notificationSettingsSchema", () => {
    const updated = updateGlobalNotificationSettings(settingsWithRules([projectRule(), sessionRule()]), {
      ...inputBase(),
      enabled: true,
      kinds: ["question", "task"],
      contextTokensThreshold: 650000,
      channels: { inApp: true, browser: true, telegram: false, macos: false },
    });
    const normalized = normalizeGlobalNotificationSettings(updated);

    expect(notificationSettingsSchema.safeParse(updated).success).toBe(true);
    expect(notificationSettingsSchema.safeParse(normalized).success).toBe(true);
  });

  it("normalizeGlobalNotificationSettings removes project-scoped rules", () => {
    const result = normalizeGlobalNotificationSettings(settingsWithRules([globalRule(), projectRule()]));

    expect(result.rules.some((rule) => rule.scope === "project")).toBe(false);
  });

  it("normalizeGlobalNotificationSettings removes session-scoped rules", () => {
    const result = normalizeGlobalNotificationSettings(settingsWithRules([globalRule(), sessionRule()]));

    expect(result.rules.some((rule) => rule.scope === "session")).toBe(false);
  });

  it("normalizeGlobalNotificationSettings keeps exactly one default-global rule", () => {
    const result = normalizeGlobalNotificationSettings(settingsWithRules([
      globalRule({ id: "first-global" }),
      globalRule({ id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID, kinds: ["alert"] }),
      globalRule({ id: "second-global" }),
    ]));

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({ id: DEFAULT_GLOBAL_NOTIFICATION_RULE_ID, scope: "global", kinds: ["alert"] });
  });

  it("unrelated safe defaults are preserved", () => {
    const input = settingsWithRules([globalRule()], {
      defaults: {
        contextTokensThreshold: 500000,
        suppressBrowserWhenVisible: false,
        rateLimit: { max: 7, windowSeconds: 30 },
      },
    });
    const result = updateGlobalNotificationSettings(input, {
      ...inputBase(),
      enabled: true,
      kinds: ["alert"],
      contextTokensThreshold: 910000,
      channels: allChannels,
    });

    expect(result.defaults.suppressBrowserWhenVisible).toBe(false);
    expect(result.defaults.rateLimit).toEqual({ max: 7, windowSeconds: 30 });
  });

  it("no mainSessionInputTokens field is written", () => {
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: true,
      kinds: ["alert"],
      contextTokensThreshold: 910000,
      channels: allChannels,
    });

    expect(stringify(result)).not.toContain("mainSessionInputTokens");
  });

  it("no telegramBotToken or secret-looking field is written", () => {
    const result = updateGlobalNotificationSettings(getDefaultNotificationSettings(), {
      ...inputBase(),
      enabled: true,
      kinds: ["question"],
      contextTokensThreshold: 500000,
      channels: { inApp: true, browser: true, telegram: true, macos: true },
    });
    const raw = stringify(result);

    expect(raw).not.toContain("telegramBotToken");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("token");
  });
});

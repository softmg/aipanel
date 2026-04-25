import { describe, expect, it } from "vitest";
import { notificationSettingsSchema, type NotificationRule, type NotificationSettings } from "@/lib/notifications/schema";
import {
  disableProjectNotificationRule,
  disableSessionNotificationRule,
  getProjectNotificationRule,
  getSessionNotificationRule,
  makeProjectRuleId,
  makeSessionRuleId,
  upsertProjectNotificationRule,
  upsertSessionNotificationRule,
} from "@/lib/notifications/rule-upsert";
import { getDefaultNotificationSettings } from "@/lib/notifications/settings";

const allChannels = {
  inApp: true,
  browser: true,
  telegram: true,
  macos: true,
};

function settingsWithRules(rules: NotificationRule[]): NotificationSettings {
  return {
    ...getDefaultNotificationSettings(),
    channels: allChannels,
    rules,
  };
}

function globalRule(id = "global"): NotificationRule {
  return {
    id,
    scope: "global",
    enabled: true,
    kinds: ["question"],
    channels: { inApp: true, browser: false, telegram: false, macos: false },
  };
}

function projectInput(overrides: Partial<Parameters<typeof upsertProjectNotificationRule>[1]> = {}) {
  return {
    projectSlug: "alpha",
    kinds: ["question", "alert"],
    channels: { inApp: true, browser: true, telegram: false, macos: false },
    contextTokensThreshold: 750000,
    ...overrides,
  } satisfies Parameters<typeof upsertProjectNotificationRule>[1];
}

function sessionInput(overrides: Partial<Parameters<typeof upsertSessionNotificationRule>[1]> = {}) {
  return {
    projectSlug: "alpha",
    sessionId: "session-1",
    kinds: ["permission", "task"],
    channels: { inApp: true, browser: false, telegram: true, macos: false },
    contextTokensThreshold: 650000,
    ...overrides,
  } satisfies Parameters<typeof upsertSessionNotificationRule>[1];
}

describe("notification rule upsert helpers", () => {
  it("upsertProjectNotificationRule creates a new project rule", () => {
    const result = upsertProjectNotificationRule(settingsWithRules([globalRule()]), projectInput());

    expect(getProjectNotificationRule(result, "alpha")).toMatchObject({
      id: "project:alpha",
      scope: "project",
      projectSlug: "alpha",
      enabled: true,
      kinds: ["question", "alert"],
      channels: { inApp: true, browser: true, telegram: false, macos: false },
      thresholds: { contextTokens: 750000 },
    });
  });

  it("upsertProjectNotificationRule updates existing project rule instead of duplicating", () => {
    const initial = upsertProjectNotificationRule(settingsWithRules([globalRule()]), projectInput());
    const result = upsertProjectNotificationRule(initial, projectInput({
      kinds: ["task"],
      channels: { inApp: false, browser: true, telegram: true, macos: false },
      contextTokensThreshold: 900000,
    }));

    expect(result.rules.filter((rule) => rule.scope === "project" && rule.projectSlug === "alpha")).toHaveLength(1);
    expect(getProjectNotificationRule(result, "alpha")).toMatchObject({
      kinds: ["task"],
      channels: { inApp: false, browser: true, telegram: true, macos: false },
      thresholds: { contextTokens: 900000 },
    });
  });

  it("upsertSessionNotificationRule creates a new session rule", () => {
    const result = upsertSessionNotificationRule(settingsWithRules([globalRule()]), sessionInput());

    expect(getSessionNotificationRule(result, "alpha", "session-1")).toMatchObject({
      id: "session:alpha:session-1",
      scope: "session",
      sessionId: "session-1",
      enabled: true,
      kinds: ["permission", "task"],
      channels: { inApp: true, browser: false, telegram: true, macos: false },
      thresholds: { contextTokens: 650000 },
    });
  });

  it("upsertSessionNotificationRule updates existing session rule instead of duplicating", () => {
    const initial = upsertSessionNotificationRule(settingsWithRules([globalRule()]), sessionInput());
    const result = upsertSessionNotificationRule(initial, sessionInput({
      kinds: ["alert"],
      channels: { inApp: true, browser: true, telegram: false, macos: true },
      contextTokensThreshold: 880000,
    }));

    expect(result.rules.filter((rule) => rule.scope === "session" && rule.sessionId === "session-1")).toHaveLength(1);
    expect(getSessionNotificationRule(result, "alpha", "session-1")).toMatchObject({
      kinds: ["alert"],
      channels: { inApp: true, browser: true, telegram: false, macos: true },
      thresholds: { contextTokens: 880000 },
    });
  });

  it("session rule includes projectSlug when provided", () => {
    const result = upsertSessionNotificationRule(settingsWithRules([]), sessionInput({ projectSlug: "project-a" }));

    expect(getSessionNotificationRule(result, "project-a", "session-1")?.projectSlug).toBe("project-a");
  });

  it("disableProjectNotificationRule disables only the matching project rule", () => {
    const base = settingsWithRules([
      globalRule(),
      {
        id: makeProjectRuleId("alpha"),
        scope: "project",
        projectSlug: "alpha",
        enabled: true,
        kinds: ["question"],
        channels: allChannels,
      },
      {
        id: makeProjectRuleId("beta"),
        scope: "project",
        projectSlug: "beta",
        enabled: true,
        kinds: ["question"],
        channels: allChannels,
      },
    ]);

    const result = disableProjectNotificationRule(base, "alpha");

    expect(getProjectNotificationRule(result, "alpha")?.enabled).toBe(false);
    expect(getProjectNotificationRule(result, "beta")?.enabled).toBe(true);
    expect(result.rules[0]?.enabled).toBe(true);
  });

  it("disableSessionNotificationRule disables only the matching session rule", () => {
    const base = settingsWithRules([
      globalRule(),
      {
        id: makeSessionRuleId("alpha", "session-1"),
        scope: "session",
        projectSlug: "alpha",
        sessionId: "session-1",
        enabled: true,
        kinds: ["question"],
        channels: allChannels,
      },
      {
        id: makeSessionRuleId("alpha", "session-2"),
        scope: "session",
        projectSlug: "alpha",
        sessionId: "session-2",
        enabled: true,
        kinds: ["question"],
        channels: allChannels,
      },
    ]);

    const result = disableSessionNotificationRule(base, "alpha", "session-1");

    expect(getSessionNotificationRule(result, "alpha", "session-1")?.enabled).toBe(false);
    expect(getSessionNotificationRule(result, "alpha", "session-2")?.enabled).toBe(true);
    expect(result.rules[0]?.enabled).toBe(true);
  });

  it("project/session rule uses thresholds.contextTokens", () => {
    const projectResult = upsertProjectNotificationRule(settingsWithRules([]), projectInput());
    const sessionResult = upsertSessionNotificationRule(settingsWithRules([]), sessionInput());

    expect(getProjectNotificationRule(projectResult, "alpha")?.thresholds).toEqual({ contextTokens: 750000 });
    expect(getSessionNotificationRule(sessionResult, "alpha", "session-1")?.thresholds).toEqual({ contextTokens: 650000 });
  });

  it("helpers preserve unrelated rules", () => {
    const unrelated = globalRule("unrelated");
    const result = upsertProjectNotificationRule(settingsWithRules([unrelated]), projectInput());

    expect(result.rules[0]).toEqual(unrelated);
  });

  it("helpers return fresh settings object and do not mutate input", () => {
    const input = settingsWithRules([globalRule()]);
    const snapshot = structuredClone(input);
    const result = upsertProjectNotificationRule(input, projectInput());

    expect(result).not.toBe(input);
    expect(result.rules).not.toBe(input.rules);
    expect(input).toEqual(snapshot);
  });

  it("helper-generated settings parse with notificationSettingsSchema", () => {
    const withProject = upsertProjectNotificationRule(settingsWithRules([globalRule()]), projectInput());
    const withSession = upsertSessionNotificationRule(withProject, sessionInput());

    expect(notificationSettingsSchema.safeParse(withSession).success).toBe(true);
  });

  it("makeSessionRuleId safely handles session ids with slashes/colons/spaces", () => {
    expect(makeSessionRuleId("alpha", "folder/session:one with spaces")).toBe(
      "session:alpha:folder%2Fsession%3Aone%20with%20spaces",
    );
  });
});

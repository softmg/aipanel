import { describe, expect, it } from "vitest";
import { getDefaultNotificationSettings } from "@/lib/notifications/settings";
import {
  isWithinQuietHours,
  matchNotificationRules,
} from "@/lib/notifications/rules";
import type { NotificationRule, NotificationSettings } from "@/lib/notifications/schema";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

const baseNotification: ClaudeNotification = {
  id: "notification-1",
  sessionId: "session-1",
  sessionLabel: "Session 1",
  projectSlug: "alpha",
  projectLabel: "Alpha",
  createdAt: "2026-04-25T12:00:00.000Z",
  kind: "question",
  title: "Needs input",
};

const allChannels = {
  inApp: true,
  browser: true,
  telegram: true,
  macos: true,
};

function rule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-1",
    scope: "global",
    enabled: true,
    kinds: ["question"],
    channels: allChannels,
    ...overrides,
  } as NotificationRule;
}

function settings(rules: NotificationRule[], overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    ...getDefaultNotificationSettings(),
    channels: allChannels,
    rules,
    ...overrides,
  };
}

function match(
  rules: NotificationRule[],
  notification: ClaudeNotification = baseNotification,
  overrides: Partial<NotificationSettings> = {},
) {
  return matchNotificationRules(notification, settings(rules, overrides), {
    now: new Date(2026, 3, 25, 12, 0),
  });
}

describe("matchNotificationRules", () => {
  it("returns no matches when settings are disabled", () => {
    expect(match([rule()], baseNotification, { enabled: false })).toEqual([]);
  });

  it("does not match disabled rules", () => {
    expect(match([rule({ enabled: false })])).toEqual([]);
  });

  it("matches global rules for any notification", () => {
    const notification = { ...baseNotification, projectSlug: "different", sessionId: "session-2" };

    expect(match([rule()], notification)).toHaveLength(1);
  });

  it("matches project rules with a matching project slug", () => {
    const projectRule = rule({ scope: "project", projectSlug: "alpha" });

    expect(match([projectRule])).toHaveLength(1);
  });

  it("does not match project rules with a different project slug", () => {
    const projectRule = rule({ scope: "project", projectSlug: "beta" });

    expect(match([projectRule])).toEqual([]);
  });

  it("does not match project rules when notification project slug is missing", () => {
    const projectRule = rule({ scope: "project", projectSlug: "alpha" });
    const notification = { ...baseNotification, projectSlug: undefined };

    expect(match([projectRule], notification)).toEqual([]);
  });

  it("matches session rules with a matching session id", () => {
    const sessionRule = rule({ scope: "session", sessionId: "session-1" });

    expect(match([sessionRule])).toHaveLength(1);
  });

  it("does not match session rules with a different session id", () => {
    const sessionRule = rule({ scope: "session", sessionId: "session-2" });

    expect(match([sessionRule])).toEqual([]);
  });

  it("does not match session rules when notification session id is missing", () => {
    const sessionRule = rule({ scope: "session", sessionId: "session-1" });
    const notification = { ...baseNotification, sessionId: "" };

    expect(match([sessionRule], notification)).toEqual([]);
  });

  it("requires both project slug and session id for session rules that include a project slug", () => {
    const sessionRule = rule({ scope: "session", sessionId: "session-1", projectSlug: "alpha" });

    expect(match([sessionRule])).toHaveLength(1);
    expect(match([sessionRule], { ...baseNotification, projectSlug: "beta" })).toEqual([]);
  });

  it("does not match kind mismatches", () => {
    expect(match([rule({ kinds: ["permission"] })])).toEqual([]);
  });

  it("returns only channels enabled by both rule and global settings", () => {
    const matched = match(
      [rule({ channels: { inApp: true, browser: true, telegram: true, macos: false } })],
      baseNotification,
      { channels: { inApp: true, browser: false, telegram: true, macos: true } },
    );

    expect(matched[0]?.channels).toEqual(["inApp", "telegram"]);
  });

  it("returns no match when no channels remain enabled", () => {
    const matched = match(
      [rule({ channels: { inApp: false, browser: true, telegram: false, macos: false } })],
      baseNotification,
      { channels: { inApp: true, browser: false, telegram: true, macos: true } },
    );

    expect(matched).toEqual([]);
  });

  it("returns matches in settings rule order", () => {
    const first = rule({ id: "first" });
    const second = rule({ id: "second" });
    const third = rule({ id: "third" });

    expect(match([first, second, third]).map((matched) => matched.rule.id)).toEqual(["first", "second", "third"]);
  });

  it("returns channels in deterministic channel order", () => {
    const matched = match([rule({ channels: { telegram: true, macos: true, inApp: true, browser: true } })]);

    expect(matched[0]?.channels).toEqual(["inApp", "browser", "telegram", "macos"]);
  });

  it("suppresses external channels during quiet hours", () => {
    const matched = matchNotificationRules(baseNotification, settings([
      rule({ quietHours: { enabled: true, start: "11:00", end: "13:00" } }),
    ]), {
      now: new Date(2026, 3, 25, 12, 0),
    });

    expect(matched[0]?.channels).toEqual(["inApp"]);
    expect(matched[0]?.suppressedChannels).toEqual([
      { channel: "browser", reason: "quiet-hours" },
      { channel: "telegram", reason: "quiet-hours" },
      { channel: "macos", reason: "quiet-hours" },
    ]);
  });

  it("does not suppress in-app notifications during quiet hours", () => {
    const matched = matchNotificationRules(baseNotification, settings([
      rule({ channels: { inApp: true, browser: false, telegram: false, macos: false }, quietHours: { enabled: true, start: "11:00", end: "13:00" } }),
    ]), {
      now: new Date(2026, 3, 25, 12, 0),
    });

    expect(matched[0]?.channels).toEqual(["inApp"]);
    expect(matched[0]?.suppressedChannels).toBeUndefined();
  });

  it("supports quiet hours that cross midnight", () => {
    const quietHours = { enabled: true, start: "22:00", end: "08:00" };

    expect(isWithinQuietHours(quietHours, new Date(2026, 3, 25, 23, 0))).toBe(true);
    expect(isWithinQuietHours(quietHours, new Date(2026, 3, 25, 7, 30))).toBe(true);
    expect(isWithinQuietHours(quietHours, new Date(2026, 3, 25, 12, 0))).toBe(false);
  });

  it("keeps external channels outside quiet hours", () => {
    const matched = matchNotificationRules(baseNotification, settings([
      rule({ quietHours: { enabled: true, start: "22:00", end: "23:00" } }),
    ]), {
      now: new Date(2026, 3, 25, 12, 0),
    });

    expect(matched[0]?.channels).toEqual(["inApp", "browser", "telegram", "macos"]);
    expect(matched[0]?.suppressedChannels).toBeUndefined();
  });

  it("does not crash or suppress for invalid quiet hours values", () => {
    const matched = matchNotificationRules(baseNotification, settings([
      rule({ quietHours: { enabled: true, start: "bad", end: "99:99" } as NotificationRule["quietHours"] }),
    ]), {
      now: new Date(2026, 3, 25, 12, 0),
    });

    expect(matched[0]?.channels).toEqual(["inApp", "browser", "telegram", "macos"]);
    expect(matched[0]?.suppressedChannels).toBeUndefined();
  });

  it("matches alert notifications with alert rules", () => {
    const alertNotification: ClaudeNotification = { ...baseNotification, kind: "alert" };

    expect(match([rule({ kinds: ["alert"] })], alertNotification)).toHaveLength(1);
  });
});

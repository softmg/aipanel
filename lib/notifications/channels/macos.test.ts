import { describe, expect, it, vi } from "vitest";
import {
  formatMacOSNotification,
  isMacOSNativeNotificationAvailable,
  sanitizeMacOSNotificationText,
  sendMacOSNativeNotification,
} from "@/lib/notifications/channels/macos";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

function createNotification(overrides: Partial<ClaudeNotification> = {}): ClaudeNotification {
  return {
    id: "notification-1",
    sessionId: "session-1",
    sessionLabel: "session · session-1",
    projectSlug: "aipanel",
    projectLabel: "aipanel",
    createdAt: "2026-04-27T08:00:00.000Z",
    kind: "task",
    title: "Task ready for review",
    status: "completed",
    details: "Assistant finished responding: pong",
    source: "derived",
    ...overrides,
  };
}

describe("macos channel helpers", () => {
  it("reports availability only on darwin", () => {
    expect(isMacOSNativeNotificationAvailable("darwin")).toBe(true);
    expect(isMacOSNativeNotificationAvailable("linux")).toBe(false);
  });

  it("redacts secret-like values", () => {
    const redacted = sanitizeMacOSNotificationText(
      "TOKEN=abcd API_KEY=qwerty password=secret Authorization: Bearer token sk-abc1234567890",
    );

    expect(redacted).not.toContain("TOKEN=abcd");
    expect(redacted).not.toContain("API_KEY=qwerty");
    expect(redacted).not.toContain("password=secret");
    expect(redacted).not.toContain("Authorization: Bearer token");
    expect(redacted).not.toContain("sk-abc1234567890");
    expect(redacted).toContain("[redacted]");
  });

  it("formats question notification with expected title and body fields", () => {
    const formatted = formatMacOSNotification(
      createNotification({
        kind: "question",
        title: "Which option should we use?",
        status: undefined,
        details: "Please choose A or B",
      }),
    );

    expect(formatted.title).toBe("Claude asks a question");
    expect(formatted.body).toContain("Project: aipanel");
    expect(formatted.body).toContain("Session: session · session-1");
    expect(formatted.body).toContain("Which option should we use?");
  });

  it("formats review-ready task notification with expected title", () => {
    const formatted = formatMacOSNotification(
      createNotification({
        title: "Task ready for review",
        details: "Assistant finished responding: pong",
      }),
    );

    expect(formatted.title).toBe("Task ready for review");
    expect(formatted.body).toContain("Task ready for review");
    expect(formatted.body).toContain("Assistant finished responding: pong");
  });

  it("truncates long title/body content", () => {
    const long = "x".repeat(5000);
    const formatted = formatMacOSNotification(
      createNotification({
        kind: "question",
        title: long,
        details: long,
      }),
    );

    expect(formatted.title.length).toBeLessThanOrEqual(120);
    expect(formatted.body.length).toBeLessThanOrEqual(512);
    expect(formatted.body).toContain("…");
  });
});

describe("sendMacOSNativeNotification", () => {
  it("returns skipped disabled when disabled", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const result = await sendMacOSNativeNotification(createNotification(), { enabled: false }, { platform: "darwin", runner });

    expect(result).toEqual({ ok: false, skipped: true, reason: "disabled" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns skipped unsupported-os on non-darwin", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const result = await sendMacOSNativeNotification(createNotification(), { enabled: true }, { platform: "linux", runner });

    expect(result).toEqual({ ok: false, skipped: true, reason: "unsupported-os" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns skipped dry-run and does not execute runner", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const result = await sendMacOSNativeNotification(
      createNotification(),
      { enabled: true, mode: "script", dryRun: true },
      { platform: "darwin", runner },
    );

    expect(result).toEqual({ ok: false, skipped: true, reason: "dry-run" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("calls osascript with safe args in script mode", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const notification = createNotification({
      kind: "question",
      title: "Which option should we use? TOKEN=abcd",
      details: "Authorization: Bearer secret",
    });

    const result = await sendMacOSNativeNotification(notification, { enabled: true, mode: "script" }, { platform: "darwin", runner });

    expect(result).toEqual({ ok: true });
    expect(runner).toHaveBeenCalledTimes(1);
    const [command, args] = runner.mock.calls[0] as [string, string[]];
    expect(command).toBe("osascript");
    expect(args[0]).toBe("-e");

    const joined = args.join(" ");
    expect(joined).toContain("display notification");

    const bodyArg = args[2] ?? "";
    const titleArg = args[3] ?? "";
    expect(bodyArg).not.toContain("TOKEN=abcd");
    expect(bodyArg).not.toContain("Authorization: Bearer secret");
    expect(titleArg).not.toContain("TOKEN=abcd");
    expect(titleArg).not.toContain("Authorization: Bearer secret");
    expect(titleArg).toContain("Claude asks a question");
  });

  it("returns skipped unavailable when runner reports missing osascript", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("spawn osascript ENOENT /usr/bin/osascript"));

    const result = await sendMacOSNativeNotification(createNotification(), { enabled: true, mode: "script" }, { platform: "darwin", runner });

    expect(result).toEqual({ ok: false, skipped: true, reason: "unavailable" });
  });

  it("returns sanitized error when runner fails", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("Telegram failed 123456:ABCtoken /bot123456:ABCtoken/sendMessage chat_id=-100123456789"));

    const result = await sendMacOSNativeNotification(createNotification(), { enabled: true, mode: "script" }, { platform: "darwin", runner });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    if ("reason" in result) {
      throw new Error("Expected non-skipped error result");
    }

    expect(result.error).toContain("[redacted-token]");
    expect(result.error).not.toContain("123456:ABCtoken");
    expect(result.error).not.toContain("/bot123456:ABCtoken/");
    expect(result.error).not.toContain("-100123456789");
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_TOKENS_THRESHOLD,
  buildContextThresholdNotification,
  clearClaudeCodeNotificationCache,
  mergeNotificationsWithContextThresholds,
  parseSessionNotifications,
} from "@/lib/sources/claude-code/notifications";
import { getNotificationEventKey } from "@/lib/notifications/events";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

afterEach(() => {
  clearClaudeCodeNotificationCache();
});

describe("claude-code notifications", () => {
  it("extracts question, permission, and task notifications from session logs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "session-123.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "assistant",
          uuid: "msg-1",
          timestamp: "2026-04-20T10:00:00.000Z",
          sessionId: "session-123",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                name: "AskUserQuestion",
                input: {
                  questions: [
                    {
                      header: "UI",
                      question: "Which panel should we use?",
                    },
                  ],
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "msg-2",
          timestamp: "2026-04-20T10:01:00.000Z",
          sessionId: "session-123",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                name: "Bash",
                input: {
                  description: "Run git status",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "queue-operation",
          uuid: "msg-3",
          timestamp: "2026-04-20T10:02:00.000Z",
          sessionId: "session-123",
          operation: "enqueue",
          content:
            "<task-notification><task-id>abc</task-id><status>completed</status><summary>Build finished</summary></task-notification>",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);
      expect(notifications).toHaveLength(3);
      expect(notifications.map((item) => item.kind)).toEqual(["task", "permission", "question"]);
      expect(notifications[0]).toMatchObject({
        title: "Build finished",
        status: "completed",
      });
      expect(notifications[1]).toMatchObject({
        title: "Run git status",
        details: "Bash",
      });
      expect(notifications[2]).toMatchObject({
        title: "Which panel should we use?",
        details: "UI",
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("derives a ready-for-review notification from a completed ping-pong assistant turn", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "ping-session.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: "2026-04-27T06:36:33.192Z",
          sessionId: "ping-session",
          message: { role: "user", content: "ping" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          timestamp: "2026-04-27T06:36:40.001Z",
          sessionId: "ping-session",
          message: {
            id: "1777271796753",
            role: "assistant",
            content: [{ type: "text", text: "pong" }],
            stop_reason: "end_turn",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const first = await parseSessionNotifications(filePath);
      clearClaudeCodeNotificationCache();
      const second = await parseSessionNotifications(filePath);

      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        sessionId: "ping-session",
        kind: "task",
        source: "derived",
        status: "completed",
        title: "Task ready for review",
        details: "Assistant finished responding: pong",
        createdAt: "2026-04-27T06:36:40.001Z",
      });
      expect(first[0]?.id).toBe(second[0]?.id);
      expect(new Set(second.map((item) => item.id)).size).toBe(second.length);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not derive ready-for-review from permission tool-use turns", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "permission-session.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: "2026-04-27T08:00:00.000Z",
          sessionId: "permission-session",
          message: { role: "user", content: "run status" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          timestamp: "2026-04-27T08:00:01.000Z",
          sessionId: "permission-session",
          message: {
            id: "assistant-message-1",
            role: "assistant",
            content: [{ type: "tool_use", name: "Bash", input: { description: "Run git status" } }],
            stop_reason: "tool_use",
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ kind: "permission", title: "Run git status" });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not derive ready-for-review while assistant turn is still running", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "running-session.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: "2026-04-27T08:00:00.000Z",
          sessionId: "running-session",
          message: { role: "user", content: "ping" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          timestamp: "2026-04-27T08:00:01.000Z",
          sessionId: "running-session",
          message: {
            id: "assistant-message-1",
            role: "assistant",
            content: [{ type: "text", text: "pong" }],
            stop_reason: null,
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      await expect(parseSessionNotifications(filePath)).resolves.toEqual([]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not add derived ready-for-review when a structured task completion already exists", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "structured-session.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "user",
          uuid: "user-1",
          timestamp: "2026-04-27T08:00:00.000Z",
          sessionId: "structured-session",
          message: { role: "user", content: "build" },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-1",
          timestamp: "2026-04-27T08:00:01.000Z",
          sessionId: "structured-session",
          message: {
            id: "assistant-message-1",
            role: "assistant",
            content: [{ type: "text", text: "Build complete." }],
            stop_reason: "end_turn",
          },
        }),
        JSON.stringify({
          type: "queue-operation",
          uuid: "task-1",
          timestamp: "2026-04-27T08:00:02.000Z",
          sessionId: "structured-session",
          operation: "enqueue",
          content:
            "<task-notification><task-id>abc</task-id><status>completed</status><summary>Build finished</summary></task-notification>",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ kind: "task", source: "log", status: "completed" });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("builds a context threshold alert when context reaches threshold", () => {
    const notification = buildContextThresholdNotification({
      sessionId: "session-main",
      title: "Primary coding session",
      startedAt: "2026-04-21T10:00:00.000Z",
      contextUsage: {
        contextTokens: DEFAULT_CONTEXT_TOKENS_THRESHOLD,
        source: "estimated-from-latest-usage",
        updatedAt: "2026-04-21T10:05:00.000Z",
      },
    });

    expect(notification).not.toBeNull();
    expect(notification).toMatchObject({
      id: `session-main-context-tokens-${DEFAULT_CONTEXT_TOKENS_THRESHOLD}-2026-04-21T10:05:00.000Z`,
      sessionId: "session-main",
      sessionLabel: "Primary coding session",
      createdAt: "2026-04-21T10:05:00.000Z",
      kind: "alert",
      status: "warning",
      source: "derived",
      title: `Context threshold reached: ${DEFAULT_CONTEXT_TOKENS_THRESHOLD.toLocaleString()} tokens`,
      details: `Context tokens: ${DEFAULT_CONTEXT_TOKENS_THRESHOLD.toLocaleString()}. Threshold: ${DEFAULT_CONTEXT_TOKENS_THRESHOLD.toLocaleString()}.`,
    });
  });

  it("does not build a threshold alert when context is below threshold", () => {
    const notification = buildContextThresholdNotification({
      sessionId: "session-main",
      title: "Primary coding session",
      startedAt: "2026-04-21T10:00:00.000Z",
      contextUsage: {
        contextTokens: DEFAULT_CONTEXT_TOKENS_THRESHOLD - 1,
        source: "estimated-from-latest-usage",
      },
    });

    expect(notification).toBeNull();
  });

  it("does not build a threshold alert when context is unavailable", () => {
    const notification = buildContextThresholdNotification({
      sessionId: "session-main",
      title: "Primary coding session",
      startedAt: "2026-04-21T10:00:00.000Z",
      contextUsage: {
        contextTokens: null,
        source: "unavailable",
      },
    });

    expect(notification).toBeNull();
  });

  it("merges context alerts with log notifications, dedupes ids, and sorts by time", () => {
    const thresholdId = `session-main-context-tokens-${DEFAULT_CONTEXT_TOKENS_THRESHOLD}-unknown`;
    const notifications: ClaudeNotification[] = [
      {
        id: thresholdId,
        sessionId: "session-main",
        sessionLabel: "session · session-m",
        createdAt: "2026-04-21T09:59:00.000Z",
        kind: "alert",
        title: "Old threshold alert",
        source: "log",
      },
      {
        id: "permission-1",
        sessionId: "session-other",
        sessionLabel: "session · session-o",
        createdAt: "2026-04-21T10:03:00.000Z",
        kind: "permission",
        title: "Run command",
        details: "Bash",
        source: "log",
      },
    ];

    const merged = mergeNotificationsWithContextThresholds(notifications, [
      {
        sessionId: "session-main",
        title: "Primary coding session",
        startedAt: "2026-04-21T10:02:00.000Z",
        contextUsage: {
          contextTokens: DEFAULT_CONTEXT_TOKENS_THRESHOLD,
          source: "estimated-from-latest-usage",
        },
      },
      {
        sessionId: "session-high-total-low-context",
        title: "High total tokens, low context",
        startedAt: "2026-04-21T10:01:00.000Z",
        contextUsage: {
          contextTokens: DEFAULT_CONTEXT_TOKENS_THRESHOLD - 1,
          source: "estimated-from-latest-usage",
        },
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.id)).toEqual(["permission-1", thresholdId]);
    expect(merged.find((item) => item.id === thresholdId)).toMatchObject({
      kind: "alert",
      source: "derived",
      sessionLabel: "Primary coding session",
      details: `Context tokens: ${DEFAULT_CONTEXT_TOKENS_THRESHOLD.toLocaleString()}. Threshold: ${DEFAULT_CONTEXT_TOKENS_THRESHOLD.toLocaleString()}.`,
    });
  });

  it("applies limit after merging and sorting notifications", () => {
    const notifications: ClaudeNotification[] = [
      {
        id: "n-older",
        sessionId: "s-1",
        sessionLabel: "session · s-1",
        createdAt: "2026-04-21T09:00:00.000Z",
        kind: "permission",
        title: "Older",
      },
      {
        id: "n-newer",
        sessionId: "s-2",
        sessionLabel: "session · s-2",
        createdAt: "2026-04-21T11:00:00.000Z",
        kind: "question",
        title: "Newer",
      },
    ];

    const merged = mergeNotificationsWithContextThresholds(
      notifications,
      [
        {
          sessionId: "s-3",
          title: "Threshold",
          startedAt: "2026-04-21T10:00:00.000Z",
          contextUsage: { contextTokens: DEFAULT_CONTEXT_TOKENS_THRESHOLD, source: "estimated-from-latest-usage" },
        },
      ],
      { limit: 1 },
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("n-newer");
  });

  it("creates api_failure notification from structured isApiErrorMessage true", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "api-structured-flag.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "system",
          uuid: "api-1",
          timestamp: "2026-04-28T10:00:00.000Z",
          sessionId: "api-structured-flag",
          isApiErrorMessage: true,
          error: "rate_limit",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ kind: "alert", status: "api_failure", title: "AI provider/API error" });
      expect(getNotificationEventKey(notifications[0]!)).toBe("error.api_failure");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates api_failure notification from structured apiErrorStatus 429", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "api-structured-429.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "system",
          uuid: "api-2",
          timestamp: "2026-04-28T10:01:00.000Z",
          sessionId: "api-structured-429",
          apiErrorStatus: 429,
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ kind: "alert", status: "api_failure" });
      expect(notifications[0]?.details).toContain("429");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("creates api_failure notifications from structured apiErrorStatus 502/503/504", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "api-structured-5xx.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "system",
          uuid: "api-502",
          timestamp: "2026-04-28T10:02:00.000Z",
          sessionId: "api-structured-5xx",
          apiErrorStatus: 502,
        }),
        JSON.stringify({
          type: "system",
          uuid: "api-503",
          timestamp: "2026-04-28T10:03:00.000Z",
          sessionId: "api-structured-5xx",
          apiErrorStatus: 503,
        }),
        JSON.stringify({
          type: "system",
          uuid: "api-504",
          timestamp: "2026-04-28T10:04:00.000Z",
          sessionId: "api-structured-5xx",
          apiErrorStatus: 504,
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);
      const apiFailures = notifications.filter((item) => item.status === "api_failure");
      expect(apiFailures).toHaveLength(3);
      expect(apiFailures.map((item) => item.details)).toEqual(
        expect.arrayContaining([expect.stringContaining("502"), expect.stringContaining("503"), expect.stringContaining("504")]),
      );
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses text fallback for strong API Error signatures", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "api-fallback-strong.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "error",
          uuid: "api-3",
          timestamp: "2026-04-28T10:05:00.000Z",
          sessionId: "api-fallback-strong",
          content: "API Error: fetch failed with UND_ERR_CONNECT_TIMEOUT",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ kind: "alert", status: "api_failure" });
      expect(notifications[0]?.details).toContain("API Error:");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not false-positive on assistant text mentioning API Error", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "api-fallback-false-positive.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "assistant",
          uuid: "assistant-api-mention",
          timestamp: "2026-04-28T10:06:00.000Z",
          sessionId: "api-fallback-false-positive",
          message: {
            role: "assistant",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "The phrase API Error: is shown as an example in docs." }],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);
      expect(notifications.some((item) => item.status === "api_failure")).toBe(false);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("redacts token-like strings in api_failure details", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aipanel-claude-notifications-"));
    const filePath = path.join(tempRoot, "api-redaction.jsonl");

    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          type: "system",
          uuid: "api-4",
          timestamp: "2026-04-28T10:07:00.000Z",
          sessionId: "api-redaction",
          isApiErrorMessage: true,
          error: "API Error: rate_limit TOKEN=secret-value 123456:AbCdEfGhIj",
        }),
      ].join("\n"),
      "utf8",
    );

    try {
      const notifications = await parseSessionNotifications(filePath);
      expect(notifications).toHaveLength(1);
      const details = notifications[0]?.details ?? "";
      expect(details).toContain("[redacted]");
      expect(details).not.toContain("TOKEN=secret-value");
      expect(details).not.toContain("123456:AbCdEfGhIj");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

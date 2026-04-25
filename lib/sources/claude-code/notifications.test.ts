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
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearClaudeCodeNotificationCache, parseSessionNotifications } from "@/lib/sources/claude-code/notifications";

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
});

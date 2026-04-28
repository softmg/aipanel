import { describe, expect, it } from "vitest";
import { getNotificationEventKey } from "@/lib/notifications/events";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

describe("notification event classification", () => {
  it("maps structured api failure notification to error.api_failure", () => {
    const notification: ClaudeNotification = {
      id: "api-failure-1",
      sessionId: "session-1",
      sessionLabel: "session · session-1",
      createdAt: "2026-04-28T10:00:00.000Z",
      kind: "alert",
      title: "AI provider/API error",
      details: "API Error: HTTP 429",
      status: "api_failure",
      source: "derived",
    };

    expect(getNotificationEventKey(notification)).toBe("error.api_failure");
  });

  it("keeps non-api alert notifications mapped to alert.context_threshold", () => {
    const notification: ClaudeNotification = {
      id: "alert-1",
      sessionId: "session-1",
      sessionLabel: "session · session-1",
      createdAt: "2026-04-28T10:00:00.000Z",
      kind: "alert",
      title: "Context threshold reached",
      details: "Context tokens: 500,000",
      status: "warning",
      source: "derived",
    };

    expect(getNotificationEventKey(notification)).toBe("alert.context_threshold");
  });
});

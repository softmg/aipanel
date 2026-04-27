import { describe, expect, it } from "vitest";
import {
  isHumanInterventionNotification,
  isQuestionNeedingAnswerNotification,
  isTaskReadyForReviewNotification,
} from "@/lib/notifications/human-intervention";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

function createNotification(overrides: Partial<ClaudeNotification> = {}): ClaudeNotification {
  return {
    id: "notification-1",
    sessionId: "session-1",
    sessionLabel: "session · session-1",
    createdAt: "2026-04-27T08:00:00.000Z",
    kind: "task",
    title: "Task ready for review",
    status: "completed",
    source: "derived",
    ...overrides,
  };
}

describe("human intervention classifier", () => {
  it("classifies questions as needing an answer", () => {
    const notification = createNotification({ kind: "question", title: "Which option should we use?" });

    expect(isQuestionNeedingAnswerNotification(notification)).toBe(true);
    expect(isHumanInterventionNotification(notification)).toBe(true);
  });

  it("classifies structured task completion as ready for review", () => {
    const notification = createNotification({ kind: "task", source: "log", status: "completed" });

    expect(isTaskReadyForReviewNotification(notification)).toBe(true);
    expect(isHumanInterventionNotification(notification)).toBe(true);
  });

  it("classifies derived assistant completion as ready for review", () => {
    const notification = createNotification({ kind: "task", source: "derived", status: "completed" });

    expect(isTaskReadyForReviewNotification(notification)).toBe(true);
    expect(isHumanInterventionNotification(notification)).toBe(true);
  });

  it("rejects permission requests and context alerts", () => {
    expect(isHumanInterventionNotification(createNotification({ kind: "permission", details: "Bash" }))).toBe(false);
    expect(isHumanInterventionNotification(createNotification({ kind: "alert", status: "warning" }))).toBe(false);
  });

  it("rejects non-completion task states", () => {
    expect(isTaskReadyForReviewNotification(createNotification({ kind: "task", status: "running" }))).toBe(false);
    expect(isHumanInterventionNotification(createNotification({ kind: "task", status: "running" }))).toBe(false);
  });
});

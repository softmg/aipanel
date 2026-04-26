import { describe, expect, it } from "vitest";
import { isTaskCompletionNotification } from "@/lib/notifications/task-completion";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

function createNotification(overrides: Partial<ClaudeNotification> = {}): ClaudeNotification {
  return {
    id: "notification-1",
    sessionId: "session-1",
    sessionLabel: "session · session-1",
    createdAt: "2026-04-26T12:00:00.000Z",
    kind: "task",
    title: "Task update",
    ...overrides,
  };
}

describe("isTaskCompletionNotification", () => {
  it("returns false for permission notifications", () => {
    expect(
      isTaskCompletionNotification(createNotification({ kind: "permission", status: "completed" })),
    ).toBe(false);
  });

  it("returns false for question notifications", () => {
    expect(
      isTaskCompletionNotification(createNotification({ kind: "question", status: "completed" })),
    ).toBe(false);
  });

  it("returns false for alert notifications", () => {
    expect(
      isTaskCompletionNotification(createNotification({ kind: "alert", status: "warning" })),
    ).toBe(false);
  });

  it("returns true for task completion notifications", () => {
    expect(
      isTaskCompletionNotification(createNotification({ status: "completed", title: "Build finished" })),
    ).toBe(true);
  });

  it("returns false for distinguishable non-completion task events", () => {
    expect(
      isTaskCompletionNotification(createNotification({ status: "running", title: "Build running" })),
    ).toBe(false);
  });

  it("does not crash when optional fields are missing", () => {
    expect(
      isTaskCompletionNotification(
        createNotification({
          title: "Task finished",
          details: undefined,
          status: undefined,
        }),
      ),
    ).toBe(true);
  });

  it("prefers structured status from details when status field is absent", () => {
    expect(
      isTaskCompletionNotification(
        createNotification({
          status: undefined,
          details: "Status: completed",
          title: "Task update",
        }),
      ),
    ).toBe(true);

    expect(
      isTaskCompletionNotification(
        createNotification({
          status: undefined,
          details: "Status: running",
          title: "Task finished",
        }),
      ),
    ).toBe(false);
  });

  it("uses text fallback when structured status is missing", () => {
    expect(
      isTaskCompletionNotification(
        createNotification({
          status: undefined,
          details: undefined,
          title: "Task completed successfully",
        }),
      ),
    ).toBe(true);

    expect(
      isTaskCompletionNotification(
        createNotification({
          status: undefined,
          details: "Still running",
          title: "Task done",
        }),
      ),
    ).toBe(false);
  });
});

import { isTaskCompletionNotification } from "@/lib/notifications/task-completion";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

export function isQuestionNeedingAnswerNotification(notification: ClaudeNotification): boolean {
  return notification.kind === "question";
}

export function isTaskReadyForReviewNotification(notification: ClaudeNotification): boolean {
  return isTaskCompletionNotification(notification);
}

export function isHumanInterventionNotification(notification: ClaudeNotification): boolean {
  return isQuestionNeedingAnswerNotification(notification) || isTaskReadyForReviewNotification(notification);
}

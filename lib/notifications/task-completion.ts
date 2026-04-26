import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

const COMPLETION_STATUSES = new Set([
  "completed",
  "complete",
  "done",
  "finished",
  "succeeded",
  "success",
]);

const NON_COMPLETION_STATUSES = new Set([
  "queued",
  "pending",
  "running",
  "in-progress",
  "in_progress",
  "started",
  "starting",
  "failed",
  "failure",
  "error",
  "errored",
  "cancelled",
  "canceled",
  "timeout",
  "timed-out",
  "timed_out",
]);

const STATUS_IN_DETAILS_PATTERN = /\bstatus\s*:\s*([^\n\r]+)/i;
const COMPLETION_TEXT_PATTERN = /\b(completed?|done|finished|succeeded|success)\b/i;
const NON_COMPLETION_TEXT_PATTERN = /\b(running|pending|queued|started|starting|in[\s-]progress|failed|failure|error|errored|cancelled|canceled|timeout)\b/i;

function normalizeStatus(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/[.\s]+$/g, "");
}

function getStructuredStatus(notification: ClaudeNotification): string | null {
  const fromStatus = normalizeStatus(notification.status);
  if (fromStatus) {
    return fromStatus;
  }

  const details = notification.details;
  if (!details) {
    return null;
  }

  const fromDetails = details.match(STATUS_IN_DETAILS_PATTERN)?.[1];
  return normalizeStatus(fromDetails);
}

export function isTaskCompletionNotification(notification: ClaudeNotification): boolean {
  if (notification.kind !== "task") {
    return false;
  }

  const structuredStatus = getStructuredStatus(notification);
  if (structuredStatus) {
    if (COMPLETION_STATUSES.has(structuredStatus)) {
      return true;
    }

    if (NON_COMPLETION_STATUSES.has(structuredStatus)) {
      return false;
    }
  }

  // Fallback for logs that omit explicit status fields.
  const text = [notification.title, notification.details].filter(Boolean).join("\n");
  if (!text) {
    return false;
  }

  if (NON_COMPLETION_TEXT_PATTERN.test(text)) {
    return false;
  }

  return COMPLETION_TEXT_PATTERN.test(text);
}

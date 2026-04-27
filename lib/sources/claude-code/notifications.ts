import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { getClaudeProjectDir } from "@/lib/sources/claude-code/paths";
import type { ClaudeNotification, SessionContextUsage } from "@/lib/sources/claude-code/types";

type RawContentItem = {
  type?: string;
  name?: string;
  text?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  input?: Record<string, unknown>;
};

type RawEvent = {
  type?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  teamName?: string;
  agentName?: string;
  operation?: string;
  content?: string;
  message?: {
    id?: string;
    role?: string;
    stop_reason?: string;
    content?: string | RawContentItem[];
  };
};

type CachedNotifications = {
  mtimeMs: number;
  value: ClaudeNotification[];
};

type ReadyForReviewCandidate = {
  event: RawEvent;
  sessionId: string;
  eventIndex: number;
  text: string;
};

export const DEFAULT_CONTEXT_TOKENS_THRESHOLD = 500_000;

export type ContextThresholdSession = {
  sessionId: string;
  title?: string;
  startedAt: string | null;
  contextUsage: SessionContextUsage;
  contextTokensThreshold?: number;
  projectSlug?: string;
  projectLabel?: string;
};

const notificationCache = new Map<string, CachedNotifications>();
const PERMISSION_TOOLS = new Set(["Bash", "Edit", "Write", "NotebookEdit", "RemoteTrigger"]);
const COMPLETION_STATUSES = new Set(["completed", "complete", "done", "finished", "succeeded", "success"]);
const COMPLETION_TEXT_PATTERN = /\b(completed?|done|finished|succeeded|success)\b/i;
const MAX_SESSION_FILES = 12;
const MAX_NOTIFICATIONS = 50;
const MAX_READY_FOR_REVIEW_DETAILS_LENGTH = 240;
const SECRET_PATTERNS: RegExp[] = [
  /\b\d{5,}:[A-Za-z0-9_-]{5,}\b/g,
  /\bbot\d{5,}:[A-Za-z0-9_-]{5,}\b/gi,
  /\bTOKEN\s*=\s*[^\s]+/gi,
  /\bAPI_KEY\s*=\s*[^\s]+/gi,
  /\bpassword\s*=\s*[^\s]+/gi,
  /\bAuthorization\s*:\s*[^\n\r]+/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
];

function parseTimestamp(value: string): number {
  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function asIso(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function buildSessionLabel(event: RawEvent, sessionId: string): string {
  const prefix = event.agentName ?? event.teamName ?? "session";
  return `${prefix} · ${sessionId.slice(0, 8)}`;
}

function buildFallbackSessionLabel(sessionId: string, title?: string): string {
  const trimmedTitle = title?.trim();
  return trimmedTitle ? trimmedTitle : `session · ${sessionId.slice(0, 8)}`;
}

function parseTaskNotification(content: string): { status?: string; summary?: string } | null {
  if (!content.includes("<task-notification>")) {
    return null;
  }

  const status = content.match(/<status>([^<]+)<\/status>/)?.[1];
  const summary = content.match(/<summary>([^<]+)<\/summary>/)?.[1];
  return { status, summary };
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function redactNotificationText(value: string): string {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[redacted]"), value);
}

function extractTextContent(content: NonNullable<RawEvent["message"]>["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
      if (typeof item.content === "string") {
        return item.content;
      }
      if (Array.isArray(item.content)) {
        return item.content.map((nested) => nested.text ?? "").join(" ");
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function isHumanPromptEvent(event: RawEvent): boolean {
  if (event.type !== "user") {
    return false;
  }

  const content = event.message?.content;
  if (typeof content === "string") {
    return Boolean(collapseWhitespace(content));
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((item) => item.type === "text" && typeof item.text === "string" && Boolean(collapseWhitespace(item.text)));
}

function extractCompletedAssistantResponseText(event: RawEvent): string | null {
  if (event.type !== "assistant" || event.message?.role !== "assistant" || event.message.stop_reason !== "end_turn") {
    return null;
  }

  const content = event.message.content;
  if (Array.isArray(content) && content.some((item) => item.type === "tool_use")) {
    return null;
  }

  const text = collapseWhitespace(extractTextContent(content));
  return text ? text : null;
}

function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function normalizeStatus(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/[.\s]+$/g, "");
}

function isStructuredTaskCompletionNotification(notification: ClaudeNotification): boolean {
  if (notification.kind !== "task" || notification.source !== "log") {
    return false;
  }

  const status = normalizeStatus(notification.status);
  if (status) {
    return COMPLETION_STATUSES.has(status);
  }

  return COMPLETION_TEXT_PATTERN.test([notification.title, notification.details].filter(Boolean).join("\n"));
}

function hasStructuredTaskCompletionAtOrAfter(
  notifications: ClaudeNotification[],
  candidate: ReadyForReviewCandidate,
): boolean {
  const candidateCreatedAt = asIso(candidate.event.timestamp) ?? new Date(0).toISOString();
  const candidateTimestamp = parseTimestamp(candidateCreatedAt);

  return notifications.some((notification) => (
    isStructuredTaskCompletionNotification(notification) && parseTimestamp(notification.createdAt) >= candidateTimestamp
  ));
}

function buildReadyForReviewNotification(candidate: ReadyForReviewCandidate): ClaudeNotification {
  const createdAt = asIso(candidate.event.timestamp) ?? new Date(0).toISOString();
  const sessionLabel = buildSessionLabel(candidate.event, candidate.sessionId);
  const stableMessageId = candidate.event.message?.id ?? candidate.event.uuid ?? `${candidate.sessionId}-${candidate.eventIndex}`;
  const safeSummary = truncate(redactNotificationText(candidate.text), MAX_READY_FOR_REVIEW_DETAILS_LENGTH);

  return {
    id: `${candidate.sessionId}-ready-for-review-${stableMessageId}-${hashContent(candidate.text)}`,
    sessionId: candidate.sessionId,
    sessionLabel,
    createdAt,
    kind: "task",
    title: "Task ready for review",
    details: safeSummary ? `Assistant finished responding: ${safeSummary}` : "Assistant finished responding. Review the result.",
    status: "completed",
    source: "derived",
  };
}

function extractNotificationsFromEvent(event: RawEvent, sessionId: string, eventIndex: number): ClaudeNotification[] {
  const createdAt = asIso(event.timestamp) ?? new Date(0).toISOString();
  const sessionLabel = buildSessionLabel(event, sessionId);
  const baseId = event.uuid ?? `${sessionId}-${eventIndex}`;
  const notifications: ClaudeNotification[] = [];

  if (event.type === "assistant" && event.message?.role === "assistant") {
    const content = Array.isArray(event.message.content) ? event.message.content : [];

    for (let index = 0; index < content.length; index += 1) {
      const item = content[index];
      if (item.type !== "tool_use") {
        continue;
      }

      if (item.name === "AskUserQuestion") {
        const rawQuestions = item.input?.questions;
        const questions = Array.isArray(rawQuestions) ? rawQuestions : [];
        questions.forEach((question, questionIndex) => {
          if (!question || typeof question !== "object") {
            return;
          }

          const prompt = Reflect.get(question, "question");
          const header = Reflect.get(question, "header");
          if (typeof prompt !== "string") {
            return;
          }

          notifications.push({
            id: `${baseId}-question-${index}-${questionIndex}`,
            sessionId,
            sessionLabel,
            createdAt,
            kind: "question",
            title: prompt,
            details: typeof header === "string" ? header : undefined,
            source: "log",
          });
        });
        continue;
      }

      if (!item.name || !PERMISSION_TOOLS.has(item.name)) {
        continue;
      }

      const description = item.input?.description;
      notifications.push({
        id: `${baseId}-permission-${index}`,
        sessionId,
        sessionLabel,
        createdAt,
        kind: "permission",
        title: typeof description === "string" ? description : `Claude requested ${item.name}`,
        details: item.name,
        source: "log",
      });
    }
  }

  if (event.type === "queue-operation" && event.operation === "enqueue" && typeof event.content === "string") {
    const task = parseTaskNotification(event.content);
    if (task) {
      notifications.push({
        id: `${baseId}-task`,
        sessionId,
        sessionLabel,
        createdAt,
        kind: "task",
        title: task.summary ?? "Task finished",
        details: task.status ? `Status: ${task.status}` : undefined,
        status: task.status,
        source: "log",
      });
    }
  }

  return notifications;
}

function formatContextDetails(contextUsage: SessionContextUsage, threshold: number): string {
  const contextTokens = Math.floor(contextUsage.contextTokens ?? 0).toLocaleString();
  const thresholdTokens = Math.floor(threshold).toLocaleString();

  if (contextUsage.contextWindowTokens && contextUsage.contextUsagePercent !== null && contextUsage.contextUsagePercent !== undefined) {
    return `Context tokens: ${contextTokens} of ${Math.floor(contextUsage.contextWindowTokens).toLocaleString()} (${Math.round(
      contextUsage.contextUsagePercent,
    )}%). Threshold: ${thresholdTokens}.`;
  }

  return `Context tokens: ${contextTokens}. Threshold: ${thresholdTokens}.`;
}

export function buildContextThresholdNotification(session: ContextThresholdSession): ClaudeNotification | null {
  const threshold = session.contextTokensThreshold ?? DEFAULT_CONTEXT_TOKENS_THRESHOLD;
  const contextTokens = session.contextUsage.contextTokens;
  if (contextTokens === null || contextTokens < threshold) {
    return null;
  }

  return {
    id: `${session.sessionId}-context-tokens-${threshold}-${session.contextUsage.updatedAt ?? "unknown"}`,
    sessionId: session.sessionId,
    sessionLabel: buildFallbackSessionLabel(session.sessionId, session.title),
    projectSlug: session.projectSlug,
    projectLabel: session.projectLabel,
    createdAt: session.contextUsage.updatedAt ?? session.startedAt ?? new Date(0).toISOString(),
    kind: "alert",
    title: `Context threshold reached: ${Math.floor(contextTokens).toLocaleString()} tokens`,
    details: formatContextDetails(session.contextUsage, threshold),
    status: "warning",
    source: "derived",
  };
}

export function mergeNotificationsWithContextThresholds(
  notifications: ClaudeNotification[],
  sessions: ContextThresholdSession[],
  options: { limit?: number } = {},
): ClaudeNotification[] {
  const byId = new Map<string, ClaudeNotification>();

  for (const notification of notifications) {
    byId.set(notification.id, {
      ...notification,
      source: notification.source ?? "log",
    });
  }

  for (const session of sessions) {
    const thresholdNotification = buildContextThresholdNotification(session);
    if (!thresholdNotification) {
      continue;
    }
    byId.set(thresholdNotification.id, thresholdNotification);
  }

  const merged = Array.from(byId.values()).sort((left, right) => {
    return parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
  });

  const limit = options.limit;
  if (typeof limit === "number") {
    return merged.slice(0, Math.max(0, limit));
  }

  return merged;
}

export async function parseSessionNotifications(filePath: string): Promise<ClaudeNotification[]> {
  const stat = await fs.stat(filePath);
  const cached = notificationCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.value;
  }

  const sessionId = path.basename(filePath, ".jsonl");
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const notifications: ClaudeNotification[] = [];

  let eventIndex = 0;
  let hasUserPromptAwaitingAssistantCompletion = false;
  let readyForReviewCandidate: ReadyForReviewCandidate | null = null;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let event: RawEvent;
    try {
      event = JSON.parse(line) as RawEvent;
    } catch {
      continue;
    }

    if (isHumanPromptEvent(event)) {
      hasUserPromptAwaitingAssistantCompletion = true;
      readyForReviewCandidate = null;
    }

    const completedAssistantText = extractCompletedAssistantResponseText(event);
    if (completedAssistantText && hasUserPromptAwaitingAssistantCompletion) {
      readyForReviewCandidate = {
        event,
        sessionId,
        eventIndex,
        text: completedAssistantText,
      };
      hasUserPromptAwaitingAssistantCompletion = false;
    }

    notifications.push(...extractNotificationsFromEvent(event, sessionId, eventIndex));
    eventIndex += 1;
  }

  if (readyForReviewCandidate && !hasStructuredTaskCompletionAtOrAfter(notifications, readyForReviewCandidate)) {
    notifications.push(buildReadyForReviewNotification(readyForReviewCandidate));
  }

  const sorted = notifications.sort((left, right) => {
    return parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
  });

  notificationCache.set(filePath, { mtimeMs: stat.mtimeMs, value: sorted });
  return sorted;
}

export async function listNotificationsForProject(projectPath: string): Promise<ClaudeNotification[]> {
  const projectDir = getClaudeProjectDir(projectPath);

  let entries: string[] = [];
  try {
    entries = await fs.readdir(projectDir);
  } catch {
    return [];
  }

  const sessionFiles = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".jsonl"))
      .map(async (entry) => {
        const filePath = path.resolve(projectDir, entry);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      }),
  );

  const notifications = await Promise.all(
    sessionFiles
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, MAX_SESSION_FILES)
      .map((entry) => parseSessionNotifications(entry.filePath)),
  );

  return notifications
    .flat()
    .sort((left, right) => parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt))
    .slice(0, MAX_NOTIFICATIONS);
}

export function clearClaudeCodeNotificationCache(): void {
  notificationCache.clear();
}

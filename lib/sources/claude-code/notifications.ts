import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { getClaudeProjectDir } from "@/lib/sources/claude-code/paths";
import type { ClaudeNotification, SessionContextUsage } from "@/lib/sources/claude-code/types";

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
    role?: string;
    content?: Array<{
      type?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
};

type CachedNotifications = {
  mtimeMs: number;
  value: ClaudeNotification[];
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
const MAX_SESSION_FILES = 12;
const MAX_NOTIFICATIONS = 50;

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

    notifications.push(...extractNotificationsFromEvent(event, sessionId, eventIndex));
    eventIndex += 1;
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

import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { getClaudeProjectDir } from "@/lib/sources/claude-code/paths";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

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

const notificationCache = new Map<string, CachedNotifications>();
const PERMISSION_TOOLS = new Set(["Bash", "Edit", "Write", "NotebookEdit", "RemoteTrigger"]);
const MAX_SESSION_FILES = 12;
const MAX_NOTIFICATIONS = 50;

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
      });
    }
  }

  return notifications;
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
    return new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf();
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
    .sort((left, right) => new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf())
    .slice(0, MAX_NOTIFICATIONS);
}

export function clearClaudeCodeNotificationCache(): void {
  notificationCache.clear();
}

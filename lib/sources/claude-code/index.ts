import fs from "node:fs/promises";
import path from "node:path";
import { clearClaudeCodeNotificationCache, listNotificationsForProject } from "@/lib/sources/claude-code/notifications";
import { getClaudeProjectDir } from "@/lib/sources/claude-code/paths";
import { clearClaudeCodeCache, parseSessionFile } from "@/lib/sources/claude-code/parser";
import type { ClaudeSessionDetail, ClaudeSessionSummary } from "@/lib/sources/claude-code/types";

export { clearClaudeCodeNotificationCache, listNotificationsForProject };
export type { ClaudeNotification, ClaudeNotificationKind } from "@/lib/sources/claude-code/types";

export async function listSessionsForProject(projectPath: string): Promise<ClaudeSessionSummary[]> {
  const projectDir = getClaudeProjectDir(projectPath);

  let entries: string[] = [];
  try {
    entries = await fs.readdir(projectDir);
  } catch {
    return [];
  }

  const sessionFiles = entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => path.resolve(projectDir, entry));

  const sessions = await Promise.all(sessionFiles.map((filePath) => parseSessionFile(filePath)));
  return sessions.sort((a, b) => {
    const left = a.lastActivityAt ? new Date(a.lastActivityAt).valueOf() : 0;
    const right = b.lastActivityAt ? new Date(b.lastActivityAt).valueOf() : 0;
    return right - left;
  });
}

export async function getSessionDetail(projectPath: string, sessionId: string): Promise<ClaudeSessionDetail | null> {
  const projectDir = getClaudeProjectDir(projectPath);
  const filePath = path.resolve(projectDir, `${sessionId}.jsonl`);

  try {
    await fs.access(filePath);
  } catch {
    return null;
  }

  return parseSessionFile(filePath);
}

export { clearClaudeCodeCache };

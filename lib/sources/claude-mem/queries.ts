import path from "node:path";
import { getClaudeMemDb } from "@/lib/sources/claude-mem/client";
import type {
  ClaudeMemObservation,
  ClaudeMemSession,
  ClaudeMemSummary,
  ProjectMatchingMode,
} from "@/lib/sources/claude-mem/types";

type RawSession = {
  content_session_id: string;
  memory_session_id: string | null;
  project: string;
  user_prompt: string | null;
  custom_title: string | null;
  started_at: string | null;
};

type RawSummary = {
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
};

type RawObservation = {
  id: number;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number | null;
  created_at: string;
};

let matchingMode: ProjectMatchingMode = "basename";

function detectMatchingMode(projectPath: string): ProjectMatchingMode {
  const db = getClaudeMemDb();
  if (!db) {
    return "basename";
  }

  const exact = db
    .prepare("SELECT count(*) as count FROM sdk_sessions WHERE project = ?")
    .get(projectPath) as { count: number } | undefined;

  if (exact && exact.count > 0) {
    return "exact";
  }

  return "basename";
}

function mapSession(raw: RawSession): ClaudeMemSession {
  return {
    contentSessionId: raw.content_session_id,
    memorySessionId: raw.memory_session_id,
    project: raw.project,
    userPrompt: raw.user_prompt,
    customTitle: raw.custom_title,
    startedAt: raw.started_at,
  };
}

export function listClaudeMemSessions(projectPath: string): ClaudeMemSession[] {
  const db = getClaudeMemDb();
  if (!db) {
    return [];
  }

  matchingMode = detectMatchingMode(projectPath);

  const value = matchingMode === "exact" ? projectPath : path.basename(projectPath);
  const rows = db
    .prepare(
      "SELECT content_session_id, memory_session_id, project, user_prompt, custom_title, started_at FROM sdk_sessions WHERE project = ? ORDER BY started_at_epoch DESC",
    )
    .all(value) as RawSession[];

  return rows.map(mapSession);
}

export function getClaudeMemSummary(memorySessionId: string): ClaudeMemSummary | null {
  const db = getClaudeMemDb();
  if (!db) {
    return null;
  }

  const row = db
    .prepare(
      "SELECT request, investigated, learned, completed, next_steps FROM session_summaries WHERE memory_session_id = ? ORDER BY created_at_epoch DESC LIMIT 1",
    )
    .get(memorySessionId) as RawSummary | undefined;

  if (!row) {
    return null;
  }

  return {
    request: row.request,
    investigated: row.investigated,
    learned: row.learned,
    completed: row.completed,
    nextSteps: row.next_steps,
  };
}

function mapObservation(raw: RawObservation): ClaudeMemObservation {
  return {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    subtitle: raw.subtitle,
    narrative: raw.narrative,
    facts: raw.facts,
    concepts: raw.concepts,
    filesRead: raw.files_read,
    filesModified: raw.files_modified,
    promptNumber: raw.prompt_number,
    createdAt: raw.created_at,
  };
}

export function listObservationsForSession(memorySessionId: string): ClaudeMemObservation[] {
  const db = getClaudeMemDb();
  if (!db) {
    return [];
  }

  const rows = db
    .prepare(
      "SELECT id, type, title, subtitle, narrative, facts, concepts, files_read, files_modified, prompt_number, created_at FROM observations WHERE memory_session_id = ? ORDER BY prompt_number ASC, id ASC",
    )
    .all(memorySessionId) as RawObservation[];

  return rows.map(mapObservation);
}

export function getProjectMatchingMode(): ProjectMatchingMode {
  return matchingMode;
}

import type {
  ClaudeMemObservation,
  ClaudeMemSession,
  ClaudeMemSummary,
  ProjectMatchingMode,
} from "@/lib/sources/claude-mem/types";
import {
  getProjectMatchingMode,
  getClaudeMemSummary,
  listClaudeMemSessions,
  listObservationsForSession,
  sessionBelongsToProject,
} from "@/lib/sources/claude-mem/queries";

export type { ClaudeMemObservation, ClaudeMemSession, ClaudeMemSummary, ProjectMatchingMode };

export async function listSessionsForProject(projectPath: string): Promise<ClaudeMemSession[]> {
  return listClaudeMemSessions(projectPath);
}

export async function getSessionSummary(memorySessionId: string): Promise<ClaudeMemSummary | null> {
  return getClaudeMemSummary(memorySessionId);
}

export async function getSessionObservations(memorySessionId: string): Promise<ClaudeMemObservation[]> {
  return listObservationsForSession(memorySessionId);
}

export async function isSessionInProject(projectPath: string, memorySessionId: string): Promise<boolean> {
  return sessionBelongsToProject(projectPath, memorySessionId);
}

export async function getMatchingMode(projectPath: string): Promise<ProjectMatchingMode> {
  listClaudeMemSessions(projectPath);
  return getProjectMatchingMode();
}

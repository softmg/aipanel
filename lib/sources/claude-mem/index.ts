import type { ClaudeMemSession, ClaudeMemSummary, ProjectMatchingMode } from "@/lib/sources/claude-mem/types";
import { getProjectMatchingMode, getClaudeMemSummary, listClaudeMemSessions } from "@/lib/sources/claude-mem/queries";

export async function listSessionsForProject(projectPath: string): Promise<ClaudeMemSession[]> {
  return listClaudeMemSessions(projectPath);
}

export async function getSessionSummary(memorySessionId: string): Promise<ClaudeMemSummary | null> {
  return getClaudeMemSummary(memorySessionId);
}

export async function getMatchingMode(projectPath: string): Promise<ProjectMatchingMode> {
  listClaudeMemSessions(projectPath);
  return getProjectMatchingMode();
}

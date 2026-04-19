import { loadProjectsConfig } from "@/lib/config/loader";
import { getTaskDetailForProject, listTasksForProject } from "@/lib/sources/beads";
import type { BeadTaskDetail } from "@/lib/sources/beads/types";
import { getSessionSummary, listSessionsForProject as listMemSessions } from "@/lib/sources/claude-mem";
import { clearClaudeCodeCache, listSessionsForProject as listClaudeSessions } from "@/lib/sources/claude-code";
import type { ProjectCard, ProjectDetail } from "@/lib/services/types";

const cache = new Map<string, { createdAt: number; detail: ProjectDetail }>();
const CACHE_TTL_MS = 30_000;

function countBeads(tasks: Array<{ status: string }>) {
  const counts = { open: 0, in_progress: 0, blocked: 0, closed: 0, other: 0 };
  for (const task of tasks) {
    if (task.status === "open") counts.open += 1;
    else if (task.status === "in_progress") counts.in_progress += 1;
    else if (task.status === "blocked") counts.blocked += 1;
    else if (task.status === "closed") counts.closed += 1;
    else counts.other += 1;
  }
  return counts;
}

function latestIso(values: Array<string | null>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).valueOf())
    .filter((value) => !Number.isNaN(value));

  if (valid.length === 0) {
    return null;
  }

  return new Date(Math.max(...valid)).toISOString();
}

export async function getProjectCards(): Promise<ProjectCard[]> {
  const projects = await loadProjectsConfig();

  const cards = await Promise.all(
    projects.map(async (project) => {
      const [sessions, beads] = await Promise.all([
        listClaudeSessions(project.absolutePath).catch(() => []),
        listTasksForProject(project.absolutePath).catch(() => []),
      ]);

      return {
        slug: project.slug,
        name: project.name,
        absolutePath: project.absolutePath,
        lastActivityAt: latestIso(sessions.map((session) => session.lastActivityAt)),
        sessionCount: sessions.length,
        totalInputTokens: sessions.reduce((sum, session) => sum + session.usage.inputTokens, 0),
        totalOutputTokens: sessions.reduce((sum, session) => sum + session.usage.outputTokens, 0),
        totalCacheReadTokens: sessions.reduce((sum, session) => sum + session.usage.cacheReadTokens, 0),
        beadsCounts: countBeads(beads),
      };
    }),
  );

  return cards.sort((left, right) => left.name.localeCompare(right.name));
}

export async function getProjectDetail(slug: string): Promise<ProjectDetail | null> {
  const cached = cache.get(slug);
  const now = Date.now();
  if (cached && now - cached.createdAt < CACHE_TTL_MS) {
    return cached.detail;
  }

  const projects = await loadProjectsConfig();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }

  const warnings: string[] = [];

  const [claudeSessions, memSessions, beads] = await Promise.all([
    listClaudeSessions(project.absolutePath).catch(() => {
      warnings.push("claude-code source unavailable");
      return [];
    }),
    listMemSessions(project.absolutePath).catch(() => {
      warnings.push("claude-mem source unavailable");
      return [];
    }),
    listTasksForProject(project.absolutePath).catch(() => {
      warnings.push("beads source unavailable");
      return [];
    }),
  ]);

  const memByContentId = new Map(memSessions.map((session) => [session.contentSessionId, session]));

  const sessions = await Promise.all(
    claudeSessions.map(async (session) => {
      const mem = memByContentId.get(session.sessionId);
      const summary = mem?.memorySessionId ? await getSessionSummary(mem.memorySessionId) : null;
      return {
        ...session,
        title: mem?.customTitle ?? mem?.userPrompt ?? undefined,
        summary,
      };
    }),
  );

  const detail: ProjectDetail = {
    project: {
      slug: project.slug,
      name: project.name,
      absolutePath: project.absolutePath,
    },
    sessions,
    beads,
    warnings,
  };

  cache.set(slug, { createdAt: now, detail });
  return detail;
}

export async function getTaskDetail(slug: string, taskId: string): Promise<BeadTaskDetail | null> {
  const projects = await loadProjectsConfig();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }

  return getTaskDetailForProject(project.absolutePath, taskId);
}

export function clearAggregatorCache(): void {
  cache.clear();
  clearClaudeCodeCache();
}

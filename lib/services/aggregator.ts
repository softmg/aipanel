import { loadProjectsConfig } from "@/lib/config/loader";
import { getTaskDetailForProject, listTasksForProject } from "@/lib/sources/beads";
import type { BeadTaskDetail } from "@/lib/sources/beads/types";
import {
  getSessionObservations,
  getSessionSummary,
  isSessionInProject,
  listSessionsForProject as listMemSessions,
} from "@/lib/sources/claude-mem";
import {
  clearClaudeCodeCache,
  clearClaudeCodeNotificationCache,
  listNotificationsForProject,
  listSessionsForProject as listClaudeSessions,
} from "@/lib/sources/claude-code";
import type { ProjectCard, ProjectDetail } from "@/lib/services/types";

type CachedSessions = {
  createdAt: number;
  sessions: ProjectDetail["sessions"];
  sessionWarnings: string[];
};

const sessionCache = new Map<string, CachedSessions>();
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

export async function getProjectCards(options: { includeBeads?: boolean } = {}): Promise<ProjectCard[]> {
  const includeBeads = options.includeBeads ?? true;
  const projects = await loadProjectsConfig();

  const cards = await Promise.all(
    projects.map(async (project) => {
      const sessionsPromise = listClaudeSessions(project.absolutePath).catch(() => []);
      const beadsPromise = includeBeads
        ? listTasksForProject(project.absolutePath).catch(() => [] as Array<{ status: string }>)
        : Promise.resolve([] as Array<{ status: string }>);
      const [sessions, beads] = await Promise.all([sessionsPromise, beadsPromise]);

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

  return cards.sort((left, right) => {
    const leftTs = left.lastActivityAt ? new Date(left.lastActivityAt).valueOf() : -Infinity;
    const rightTs = right.lastActivityAt ? new Date(right.lastActivityAt).valueOf() : -Infinity;
    if (leftTs !== rightTs) {
      return rightTs - leftTs;
    }
    return left.name.localeCompare(right.name);
  });
}

async function getSessionsForProject(
  project: { absolutePath: string; slug: string },
): Promise<{ sessions: ProjectDetail["sessions"]; sessionWarnings: string[] }> {
  const cached = sessionCache.get(project.slug);
  const now = Date.now();
  if (cached && now - cached.createdAt < CACHE_TTL_MS) {
    return { sessions: cached.sessions, sessionWarnings: cached.sessionWarnings };
  }

  const sessionWarnings: string[] = [];

  const [claudeSessions, memSessions] = await Promise.all([
    listClaudeSessions(project.absolutePath).catch(() => {
      sessionWarnings.push("claude-code source unavailable");
      return [];
    }),
    listMemSessions(project.absolutePath).catch(() => {
      sessionWarnings.push("claude-mem source unavailable");
      return [];
    }),
  ]);

  const memByContentId = new Map(memSessions.map((session) => [session.contentSessionId, session]));

  const sessions = await Promise.all(
    claudeSessions.map(async (session) => {
      const mem = memByContentId.get(session.sessionId);
      const summary = mem?.memorySessionId ? await getSessionSummary(mem.memorySessionId) : null;
      const title = mem?.customTitle ?? mem?.userPrompt ?? session.title;
      return {
        ...session,
        title,
        needsTitleRefresh: !title && session.needsTitleRefresh,
        summary,
        memorySessionId: mem?.memorySessionId ?? null,
      };
    }),
  );

  sessionCache.set(project.slug, { createdAt: now, sessions, sessionWarnings });
  return { sessions, sessionWarnings };
}

export async function getProjectDetail(slug: string): Promise<ProjectDetail | null> {
  const projects = await loadProjectsConfig();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }

  const [{ sessions, sessionWarnings }, beads, notifications] = await Promise.all([
    getSessionsForProject(project),
    listTasksForProject(project.absolutePath).catch(() => null),
    listNotificationsForProject(project.absolutePath).catch(() => []),
  ]);

  const notificationsWithProject = notifications.map((notification) => ({
    ...notification,
    projectSlug: project.slug,
    projectLabel: project.name,
  }));

  const warnings = [...sessionWarnings];
  if (beads === null) {
    warnings.push("beads source unavailable");
  }

  return {
    project: {
      slug: project.slug,
      name: project.name,
      absolutePath: project.absolutePath,
    },
    sessions,
    beads: beads ?? [],
    notifications: notificationsWithProject,
    warnings,
  };
}

export async function getTaskDetail(slug: string, taskId: string): Promise<BeadTaskDetail | null> {
  const projects = await loadProjectsConfig();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }

  return getTaskDetailForProject(project.absolutePath, taskId);
}

export async function getProjectSessionObservations(
  slug: string,
  memorySessionId: string,
): Promise<ReturnType<typeof getSessionObservations> | null> {
  const projects = await loadProjectsConfig();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return null;
  }

  const belongs = await isSessionInProject(project.absolutePath, memorySessionId);
  if (!belongs) {
    return null;
  }

  return getSessionObservations(memorySessionId);
}

export async function getProjectNotifications(slug: string) {
  const projects = await loadProjectsConfig();
  const project = projects.find((item) => item.slug === slug);
  if (!project) {
    return [];
  }

  const notifications = await listNotificationsForProject(project.absolutePath);
  return notifications.map((notification) => ({
    ...notification,
    projectSlug: project.slug,
    projectLabel: project.name,
  }));
}

export function clearAggregatorCache(): void {
  sessionCache.clear();
  clearClaudeCodeCache();
  clearClaudeCodeNotificationCache();
}

"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatNumber, formatRelative } from "@/lib/format";
import { AgentOffice } from "@/components/projects/AgentOffice";
import { TaskDetailDrawer } from "@/components/projects/TaskDetailDrawer";
import type { ClaudeMemObservation } from "@/lib/sources/claude-mem/types";
import type { ClaudeSessionSummary } from "@/lib/sources/claude-code/types";
import type { ProjectDetail as ProjectDetailData } from "@/lib/services/types";

type Props = {
  data: ProjectDetailData;
};

type ObservationState = {
  status: "idle" | "loading" | "loaded" | "error";
  items: ClaudeMemObservation[];
};

type ObservationEntry = {
  id: number;
  timeLabel: string;
  typeIcon: string;
  typeLabel: string;
  title: string;
};

type ObservationGroup = {
  fileLabel: string;
  entries: ObservationEntry[];
};

type ObservationDay = {
  dateLabel: string;
  groups: ObservationGroup[];
};

const sessionsTabId = "project-detail-tab-sessions";
const officeTabId = "project-detail-tab-office";
const tasksTabId = "project-detail-tab-tasks";
const sessionsPanelId = "project-detail-panel-sessions";
const officePanelId = "project-detail-panel-office";
const tasksPanelId = "project-detail-panel-tasks";

const tabButtonBaseClass =
  "rounded px-3 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2";
const INITIAL_VISIBLE_SESSIONS = 10;
const LIVE_OBSERVATIONS_URL = "http://localhost:37777";
const emptyObservationState: ObservationState = { status: "idle", items: [] };

function getObservationTypeMeta(type: string): { icon: string; label: string } {
  if (type === "bugfix") {
    return { icon: "🔴", label: "Bugfix" };
  }
  if (type === "feature") {
    return { icon: "🟣", label: "Feature" };
  }
  if (type === "refactor") {
    return { icon: "🔄", label: "Refactor" };
  }
  if (type === "change") {
    return { icon: "✅", label: "Change" };
  }
  if (type === "discovery") {
    return { icon: "🔵", label: "Discovery" };
  }
  if (type === "decision") {
    return { icon: "⚖️", label: "Decision" };
  }

  return { icon: "•", label: type };
}

function getDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "Unknown date";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getActivityBadgeClass(state: "active" | "idle"): string {
  return state === "active"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
    : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

function getActivityLabel(state: "active" | "idle"): string {
  return state === "active" ? "Active" : "Idle";
}

type SessionTeamBadgeProps = {
  session: ClaudeSessionSummary;
  active: boolean;
};

function SessionTeamBadge({ session, active }: SessionTeamBadgeProps) {
  const agents = session.subagents ?? [];
  const totalTokens = agents.reduce((sum, agent) => {
    return (
      sum +
      agent.usage.inputTokens +
      agent.usage.outputTokens +
      agent.usage.cacheReadTokens +
      agent.usage.cacheCreationTokens
    );
  }, 0);
  const teamState = active ? "active" : "idle";
  const [open, setOpen] = useState(false);
  const latestAgentTimestamp = agents.reduce((latest, agent) => {
    const timestamp = agent.lastActivityAt ? new Date(agent.lastActivityAt).valueOf() : Number.NaN;
    return Number.isNaN(timestamp) ? latest : Math.max(latest, timestamp);
  }, Number.NEGATIVE_INFINITY);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={`Team ${session.subagentCount}. ${getActivityLabel(teamState)}. Hover or focus for agent details.`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:bg-violet-500/20 dark:text-violet-300"
      >
        Team {session.subagentCount}
      </button>
      <div className={`absolute left-0 top-full z-20 mt-2 min-w-[320px] max-w-[420px] rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 ${open ? "block" : "hidden"}`}>
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Agent Team</p>
              <p className="text-[11px] text-zinc-500">
                {agents.length} agents · {formatNumber(totalTokens)} tokens
              </p>
            </div>
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${getActivityBadgeClass(teamState)}`}>
              {getActivityLabel(teamState)}
            </span>
          </div>
          <div className="space-y-1.5">
            {agents.map((agent) => {
              const agentTokens =
                agent.usage.inputTokens +
                agent.usage.outputTokens +
                agent.usage.cacheReadTokens +
                agent.usage.cacheCreationTokens;
              const agentTimestamp = agent.lastActivityAt ? new Date(agent.lastActivityAt).valueOf() : Number.NaN;
              const agentState =
                active && !Number.isNaN(agentTimestamp) && agentTimestamp === latestAgentTimestamp ? "active" : "idle";

              return (
                <div
                  key={agent.agentId}
                  className="rounded border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="truncate font-mono text-zinc-700 dark:text-zinc-200">@{agent.agentName}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${getActivityBadgeClass(agentState)}`}>
                      {getActivityLabel(agentState)}
                    </span>
                  </div>
                  <p suppressHydrationWarning className="mt-1 text-[11px] text-zinc-500">
                    {formatNumber(agentTokens)} tokens · {agent.turns} turns · {formatRelative(agent.lastActivityAt)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function parseObservationFiles(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {}
  }

  return trimmed
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getObservationFileLabel(observation: ClaudeMemObservation): string {
  const filesModified = parseObservationFiles(observation.filesModified);
  if (filesModified.length > 0) {
    return filesModified[0];
  }

  const filesRead = parseObservationFiles(observation.filesRead);
  if (filesRead.length > 0) {
    return filesRead[0];
  }

  return "General";
}

function getObservationTitle(observation: ClaudeMemObservation): string {
  return observation.title ?? observation.subtitle ?? observation.narrative ?? observation.type;
}

function groupObservations(items: ClaudeMemObservation[]): ObservationDay[] {
  const days = new Map<string, { dateLabel: string; groups: Map<string, ObservationEntry[]> }>();

  for (const observation of items) {
    const dateLabel = getDateLabel(observation.createdAt);
    const fileLabel = getObservationFileLabel(observation);
    const type = getObservationTypeMeta(observation.type);
    const entry: ObservationEntry = {
      id: observation.id,
      timeLabel: getTimeLabel(observation.createdAt),
      typeIcon: type.icon,
      typeLabel: type.label,
      title: getObservationTitle(observation),
    };

    const existingDay = days.get(dateLabel);
    if (!existingDay) {
      days.set(dateLabel, {
        dateLabel,
        groups: new Map([[fileLabel, [entry]]]),
      });
      continue;
    }

    const existingGroup = existingDay.groups.get(fileLabel);
    if (existingGroup) {
      existingGroup.push(entry);
      continue;
    }

    existingDay.groups.set(fileLabel, [entry]);
  }

  return Array.from(days.values()).map((day) => ({
    dateLabel: day.dateLabel,
    groups: Array.from(day.groups.entries()).map(([fileLabel, entries]) => ({
      fileLabel,
      entries,
    })),
  }));
}

export function ProjectDetail({ data }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"sessions" | "office" | "tasks">("sessions");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [visibleSessionsCount, setVisibleSessionsCount] = useState(INITIAL_VISIBLE_SESSIONS);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [refreshingTitles, setRefreshingTitles] = useState(false);
  const [observationStates, setObservationStates] = useState<Record<string, ObservationState>>({});

  const grouped = useMemo(() => {
    return {
      open: data.beads.filter((item) => item.status === "open"),
      in_progress: data.beads.filter((item) => item.status === "in_progress"),
      blocked: data.beads.filter((item) => item.status === "blocked"),
      closed: data.beads.filter((item) => item.status === "closed"),
    };
  }, [data.beads]);

  const visibleSessions = useMemo(
    () => data.sessions.slice(0, visibleSessionsCount),
    [data.sessions, visibleSessionsCount],
  );
  const canLoadMoreSessions = visibleSessionsCount < data.sessions.length;
  const sessionsWithEmptyTitles = data.sessions.filter((session) => !session.title?.trim()).length;

  const activeSessionId = useMemo(() => {
    return data.sessions.find((session) => session.lastActivityAt)?.sessionId ?? null;
  }, [data.sessions]);

  async function loadObservations(memorySessionId: string) {
    setObservationStates((current) => ({
      ...current,
      [memorySessionId]: { status: "loading", items: current[memorySessionId]?.items ?? [] },
    }));

    try {
      const response = await fetch(
        `/api/projects/${data.project.slug}/sessions/${memorySessionId}/observations`,
      );

      if (!response.ok) {
        throw new Error("failed");
      }

      const items = (await response.json()) as ClaudeMemObservation[];
      setObservationStates((current) => ({
        ...current,
        [memorySessionId]: { status: "loaded", items },
      }));
    } catch {
      setObservationStates((current) => ({
        ...current,
        [memorySessionId]: { status: "error", items: [] },
      }));
    }
  }

  function toggleSession(sessionId: string, memorySessionId: string | null | undefined) {
    setExpandedSessionId((current) => (current === sessionId ? null : sessionId));

    if (!memorySessionId) {
      return;
    }

    const state = observationStates[memorySessionId] ?? emptyObservationState;
    if (state.status === "idle") {
      void loadObservations(memorySessionId);
    }
  }

  async function refreshEmptyTitles() {
    setRefreshingTitles(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      router.refresh();
    } finally {
      setRefreshingTitles(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="border-b border-zinc-200 p-4 pr-16 dark:border-zinc-800">
        <h1 className="truncate text-xl font-semibold">{data.project.name}</h1>
        <p className="truncate text-xs text-zinc-500">{data.project.absolutePath}</p>
      </header>

      <div
        role="tablist"
        aria-label="Project detail views"
        className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800"
      >
        <button
          id={sessionsTabId}
          type="button"
          role="tab"
          aria-selected={tab === "sessions"}
          aria-controls={sessionsPanelId}
          onClick={() => setTab("sessions")}
          className={`${tabButtonBaseClass} ${
            tab === "sessions"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          Sessions ({data.sessions.length})
        </button>
        <button
          id={officeTabId}
          type="button"
          role="tab"
          aria-selected={tab === "office"}
          aria-controls={officePanelId}
          onClick={() => setTab("office")}
          className={`${tabButtonBaseClass} ${
            tab === "office"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          Office
        </button>
        <button
          id={tasksTabId}
          type="button"
          role="tab"
          aria-selected={tab === "tasks"}
          aria-controls={tasksPanelId}
          onClick={() => setTab("tasks")}
          className={`${tabButtonBaseClass} ${
            tab === "tasks"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          Tasks ({data.beads.length})
        </button>
      </div>

      <main className="flex-1 overflow-auto p-4">
        {data.warnings.length > 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <p className="font-medium">Partial data loaded</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {tab === "sessions" ? (
          <section id={sessionsPanelId} role="tabpanel" aria-labelledby={sessionsTabId}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {sessionsWithEmptyTitles > 0
                  ? `${sessionsWithEmptyTitles} sessions still have no title source`
                  : "All sessions have titles"}
              </p>
              <button
                type="button"
                onClick={refreshEmptyTitles}
                disabled={refreshingTitles}
                aria-label="Update empty session titles"
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {refreshingTitles ? "Updating titles…" : "Update empty titles"}
              </button>
            </div>
            <div className="overflow-x-auto overflow-y-visible rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">In/Out</th>
                    <th className="px-3 py-2">Cache Read</th>
                    <th className="px-3 py-2">Prompts</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSessions.map((session) => {
                    const isExpanded = expandedSessionId === session.sessionId;
                    const observationState = session.memorySessionId
                      ? (observationStates[session.memorySessionId] ?? emptyObservationState)
                      : null;
                    const groupedObservations = observationState
                      ? groupObservations(observationState.items)
                      : [];

                    return (
                      <Fragment key={session.sessionId}>
                        <tr className="border-t border-zinc-200 dark:border-zinc-800">
                          <td suppressHydrationWarning className="px-3 py-2 text-xs text-zinc-500">
                            {formatRelative(session.lastActivityAt)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              {session.memorySessionId ? (
                                <button
                                  type="button"
                                  onClick={() => toggleSession(session.sessionId, session.memorySessionId)}
                                  aria-expanded={isExpanded}
                                  aria-controls={`session-observations-${session.sessionId}`}
                                  aria-label={`${isExpanded ? "Collapse" : "Expand"} observations for ${session.title ?? session.sessionId}`}
                                  title={isExpanded ? "Collapse observations" : "Expand observations"}
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-600 transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                                >
                                  <svg
                                    viewBox="0 0 20 20"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                    aria-hidden="true"
                                  >
                                    <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              ) : (
                                <span className="inline-flex h-6 w-6 shrink-0" aria-hidden="true" />
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard.writeText(`claude --resume ${session.sessionId}`);
                                }}
                                aria-label={`Copy resume command for ${session.title ?? session.sessionId}`}
                                title="Copy resume command"
                                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-zinc-300 text-zinc-600 transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                              >
                                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5" aria-hidden="true">
                                  <rect x="7" y="3" width="10" height="12" rx="2" />
                                  <rect x="3" y="7" width="10" height="10" rx="2" />
                                </svg>
                              </button>
                              <p className="max-w-[320px] truncate">{session.title?.trim() || session.sessionId}</p>
                              {session.subagentCount > 0 ? (
                                <SessionTeamBadge session={session} active={activeSessionId === session.sessionId} />
                              ) : null}
                              {activeSessionId === session.sessionId ? (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                                  Active
                                </span>
                              ) : null}
                            </div>
                            {session.summary?.completed ? (
                              <p className="max-w-[420px] truncate text-xs text-zinc-500">{session.summary.completed}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {formatNumber(session.usage.inputTokens)} / {formatNumber(session.usage.outputTokens)}
                          </td>
                          <td className="px-3 py-2 text-xs">{formatNumber(session.usage.cacheReadTokens)}</td>
                          <td className="px-3 py-2 text-xs">{session.userPromptCount}</td>
                        </tr>
                        {isExpanded ? (
                          <tr
                            id={`session-observations-${session.sessionId}`}
                            className="border-t border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40"
                          >
                            <td colSpan={5} className="px-4 py-4">
                              <div className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium">Claude-mem observations</p>
                                  <a
                                    href={LIVE_OBSERVATIONS_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                                  >
                                    View Observations Live
                                  </a>
                                </div>

                                {!session.memorySessionId ? (
                                  <p className="text-xs text-zinc-500">This session has no claude-mem link.</p>
                                ) : null}

                                {observationState?.status === "loading" ? (
                                  <p className="text-xs text-zinc-500">Loading observations…</p>
                                ) : null}

                                {observationState?.status === "error" ? (
                                  <p className="text-xs text-red-600 dark:text-red-400">
                                    Failed to load observations.
                                  </p>
                                ) : null}

                                {session.subagentCount > 0 ? (
                                  <details className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
                                    <summary className="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-200">
                                      Agent Team · {session.subagentCount}
                                    </summary>
                                    <div className="mt-2 space-y-1">
                                      {(session.subagents ?? []).map((agent) => (
                                        <div
                                          key={agent.agentId}
                                          className="flex items-center justify-between gap-3 rounded bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-900"
                                        >
                                          <span className="truncate font-mono text-zinc-600 dark:text-zinc-300">
                                            @{agent.agentName}
                                          </span>
                                          <span suppressHydrationWarning className="shrink-0 text-right text-zinc-500">
                                            {formatNumber(
                                              agent.usage.inputTokens +
                                                agent.usage.outputTokens +
                                                agent.usage.cacheReadTokens +
                                                agent.usage.cacheCreationTokens,
                                            )}{" "}
                                            tokens · {agent.turns} turns · {formatRelative(agent.lastActivityAt)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                ) : (
                                  <p className="text-xs text-zinc-500">No Agent Team activity in this session.</p>
                                )}

                                {observationState?.status === "loaded" && groupedObservations.length === 0 ? (
                                  <p className="text-xs text-zinc-500">No observations recorded for this session.</p>
                                ) : null}

                                {observationState?.status === "loaded"
                                  ? groupedObservations.map((day) => (
                                      <div key={day.dateLabel} className="space-y-3">
                                        <p className="text-sm font-semibold">{day.dateLabel}</p>
                                        <div className="space-y-3">
                                          {day.groups.map((group) => (
                                            <div key={`${day.dateLabel}-${group.fileLabel}`} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                                              <p className="font-mono text-xs text-zinc-500">{group.fileLabel}</p>
                                              <ul className="mt-2 space-y-2">
                                                {group.entries.map((entry) => (
                                                  <li key={entry.id} className="flex items-start gap-2 text-sm">
                                                    <span className="shrink-0 text-base leading-5" aria-hidden="true">
                                                      {entry.typeIcon}
                                                    </span>
                                                    <div className="min-w-0">
                                                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                                        {entry.timeLabel ? <span>{entry.timeLabel}</span> : null}
                                                        <span>{entry.typeLabel}</span>
                                                      </div>
                                                      <p className="mt-0.5 break-words">{entry.title}</p>
                                                    </div>
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))
                                  : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canLoadMoreSessions ? (
              <button
                type="button"
                onClick={() => setVisibleSessionsCount((current) => current + INITIAL_VISIBLE_SESSIONS)}
                className="mt-3 rounded-lg border border-zinc-300 px-3 py-2 text-sm transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Загрузить ещё
              </button>
            ) : null}
          </section>
        ) : tab === "office" ? (
          <section id={officePanelId} role="tabpanel" aria-labelledby={officeTabId}>
            <AgentOffice data={data} activeSessionId={activeSessionId} />
          </section>
        ) : (
          <section id={tasksPanelId} role="tabpanel" aria-labelledby={tasksTabId}>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              {[
                { key: "open", title: "OPEN", color: "text-blue-600" },
                { key: "in_progress", title: "IN PROGRESS", color: "text-amber-600" },
                { key: "blocked", title: "BLOCKED", color: "text-red-600" },
                { key: "closed", title: "DONE", color: "text-zinc-500" },
              ].map((column) => {
                const tasks = grouped[column.key as keyof typeof grouped];
                return (
                  <section key={column.key} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className={`text-sm font-semibold ${column.color}`}>{column.title}</h3>
                      <span className="text-xs text-zinc-500">{tasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {tasks.length === 0 ? (
                        <div className="rounded border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
                          No tasks
                        </div>
                      ) : (
                        tasks.map((task) => (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => setActiveTaskId(task.id)}
                            aria-label={`Open details for ${task.id}: ${task.title}`}
                            className="w-full rounded border border-zinc-200 p-2 text-left transition-colors hover:border-zinc-400 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
                          >
                            <p className="text-xs text-zinc-500">{task.id}</p>
                            <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
                            <div className="mt-1 flex gap-1 text-[10px] text-zinc-500">
                              {task.type ? <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{task.type}</span> : null}
                              {typeof task.priority === "number" ? (
                                <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">P{task.priority}</span>
                              ) : null}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <TaskDetailDrawer
        slug={data.project.slug}
        taskId={activeTaskId}
        onClose={() => setActiveTaskId(null)}
      />
    </div>
  );
}

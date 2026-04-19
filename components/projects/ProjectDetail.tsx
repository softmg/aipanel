"use client";

import { useMemo, useState } from "react";
import { formatNumber, formatRelative } from "@/lib/format";
import type { ProjectDetail as ProjectDetailData } from "@/lib/services/types";

type Props = {
  data: ProjectDetailData;
};

const sessionsTabId = "project-detail-tab-sessions";
const tasksTabId = "project-detail-tab-tasks";
const sessionsPanelId = "project-detail-panel-sessions";
const tasksPanelId = "project-detail-panel-tasks";

const tabButtonBaseClass =
  "rounded px-3 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2";

export function ProjectDetail({ data }: Props) {
  const [tab, setTab] = useState<"sessions" | "tasks">("sessions");

  const grouped = useMemo(() => {
    return {
      open: data.beads.filter((item) => item.status === "open"),
      in_progress: data.beads.filter((item) => item.status === "in_progress"),
      blocked: data.beads.filter((item) => item.status === "blocked"),
      closed: data.beads.filter((item) => item.status === "closed"),
    };
  }, [data.beads]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold">{data.project.name}</h1>
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
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
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
                  {data.sessions.map((session) => (
                    <tr key={session.sessionId} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-3 py-2 text-xs text-zinc-500">{formatRelative(session.lastActivityAt)}</td>
                      <td className="px-3 py-2">
                        <p className="max-w-[420px] truncate">{session.title ?? session.sessionId}</p>
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
                  ))}
                </tbody>
              </table>
            </div>
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
                          <article key={task.id} className="rounded border border-zinc-200 p-2 dark:border-zinc-700">
                            <p className="text-xs text-zinc-500">{task.id}</p>
                            <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
                            <div className="mt-1 flex gap-1 text-[10px] text-zinc-500">
                              {task.type ? <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{task.type}</span> : null}
                              {typeof task.priority === "number" ? (
                                <span className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">P{task.priority}</span>
                              ) : null}
                            </div>
                          </article>
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
    </div>
  );
}

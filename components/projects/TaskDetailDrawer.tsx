"use client";

import { useEffect, useRef, useState } from "react";
import { formatRelative } from "@/lib/format";
import type { BeadTaskDetail } from "@/lib/sources/beads/types";

type Props = {
  slug: string;
  taskId: string | null;
  onClose: () => void;
};

type LoadedState =
  | { status: "error"; taskId: string; message: string }
  | { status: "ready"; taskId: string; detail: BeadTaskDetail };

export function TaskDetailDrawer({ slug, taskId, onClose }: Props) {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const open = taskId !== null;

  useEffect(() => {
    if (!taskId) {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/projects/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? `Request failed (${response.status})`);
        }
        return (await response.json()) as BeadTaskDetail;
      })
      .then((detail) => setLoaded({ status: "ready", taskId, detail }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        setLoaded({ status: "error", taskId, message });
      });

    return () => controller.abort();
  }, [slug, taskId]);

  const state: "loading" | "error" | "ready" =
    taskId === null
      ? "loading"
      : loaded && loaded.taskId === taskId
        ? loaded.status
        : "loading";

  useEffect(() => {
    if (!open) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKey);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close task details"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">{taskId}</p>
            <h2 id="task-detail-title" className="truncate text-base font-semibold">
              {state === "ready" && loaded?.status === "ready" ? loaded.detail.title : "Task details"}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-auto px-4 py-4 text-sm">
          {state === "loading" ? (
            <p className="text-xs text-zinc-500">Loading…</p>
          ) : null}

          {state === "error" && loaded?.status === "error" ? (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
            >
              Could not load task: {loaded.message}
            </div>
          ) : null}

          {state === "ready" && loaded?.status === "ready" ? (
            <DetailBody detail={loaded.detail} />
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function DetailBody({ detail }: { detail: BeadTaskDetail }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        <Badge>{detail.status}</Badge>
        {detail.type ? <Badge>{detail.type}</Badge> : null}
        {typeof detail.priority === "number" ? <Badge>P{detail.priority}</Badge> : null}
        {detail.assignee ? <Badge>{detail.assignee}</Badge> : null}
      </div>

      <Section title="Description" body={detail.description} />
      <Section title="Design" body={detail.design} />
      <Section title="Acceptance criteria" body={detail.acceptance_criteria} />
      <Section title="Notes" body={detail.notes} />

      <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
        {detail.created_at ? (
          <Meta label="Created" value={formatRelative(detail.created_at)} />
        ) : null}
        {detail.updated_at ? (
          <Meta label="Updated" value={formatRelative(detail.updated_at)} />
        ) : null}
        {detail.closed_at ? (
          <Meta label="Closed" value={formatRelative(detail.closed_at)} />
        ) : null}
        {detail.close_reason ? <Meta label="Close reason" value={detail.close_reason} /> : null}
      </dl>
    </div>
  );
}

function Section({ title, body }: { title: string; body?: string }) {
  if (!body) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{children}</span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-xs text-zinc-600 dark:text-zinc-400">{value}</dd>
    </div>
  );
}

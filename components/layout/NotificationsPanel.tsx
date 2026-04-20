"use client";

import { useEffect, useRef } from "react";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

type Props = {
  notifications: ClaudeNotification[];
  open: boolean;
  onClose: () => void;
};

function getKindLabel(notification: ClaudeNotification): string {
  if (notification.kind === "question") {
    return "Question";
  }
  if (notification.kind === "permission") {
    return "Permission";
  }
  return notification.status ? `Task · ${notification.status}` : "Task";
}

function getKindClass(notification: ClaudeNotification): string {
  if (notification.kind === "question") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300";
  }
  if (notification.kind === "permission") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300";
  }
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300";
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "—";
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function NotificationsPanel({ notifications, open, onClose }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

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
        aria-label="Close notifications"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/30"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h2 id="notifications-title" className="text-sm font-semibold">Notifications</h2>
            <p className="text-xs text-zinc-500">Claude asks, permission requests, task completion</p>
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

        <div className="flex-1 overflow-auto p-3">
          {notifications.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
              No notifications yet.
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <article
                  key={notification.id}
                  className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${getKindClass(notification)}`}>
                      {getKindLabel(notification)}
                    </span>
                    <span className="text-[10px] text-zinc-500">{formatTime(notification.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium break-words">{notification.title}</p>
                  {notification.details ? (
                    <p className="mt-1 text-xs text-zinc-500 break-words">{notification.details}</p>
                  ) : null}
                  <div className="mt-2 rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    Project: {notification.projectLabel ?? notification.projectSlug ?? "—"} · Session: {notification.sessionLabel}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

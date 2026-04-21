"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotificationsPanel } from "@/components/layout/NotificationsPanel";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { RealtimeUpdates, type RealtimeNotificationItem } from "@/components/layout/RealtimeUpdates";
import { ProjectSidebar } from "@/components/projects/ProjectSidebar";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";
import type { ProjectCard } from "@/lib/services/types";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_NOTIFICATIONS = 3;

type Props = {
  projects: ProjectCard[];
  activeSlug?: string;
  notifications?: ClaudeNotification[];
  children: React.ReactNode;
};

function canUseBrowserNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function getNotificationKey(item: { id: string; projectSlug?: string }): string {
  return `${item.projectSlug ?? "global"}:${item.id}`;
}

function getNotificationBody(item: RealtimeNotificationItem): string {
  const project = item.projectLabel ?? item.projectSlug ?? "Unknown project";
  if (item.kind === "task" && item.status) {
    return `${project} · Task ${item.status}`;
  }
  return `${project} · ${item.sessionLabel}`;
}

export function AppShell({ projects, activeSlug, notifications = [], children }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const realtimeEnabled = process.env.NEXT_PUBLIC_AIPANEL_REALTIME_ENABLED === "true";
  const browserPushEnabled = process.env.NEXT_PUBLIC_AIPANEL_BROWSER_NOTIFICATIONS_ENABLED === "true";
  const [hasUpdates, setHasUpdates] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const seenNotificationKeysRef = useRef<Set<string>>(new Set());
  const sentAtRef = useRef<number[]>([]);

  useEffect(() => {
    for (const notification of notifications) {
      seenNotificationKeysRef.current.add(getNotificationKey(notification));
    }
  }, [notifications]);

  useEffect(() => {
    if (!browserPushEnabled || !canUseBrowserNotifications()) {
      return;
    }

    const syncPermission = () => {
      setPermission(window.Notification.permission);
    };

    syncPermission();
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, [browserPushEnabled]);

  const handleIncomingNotifications = (items: RealtimeNotificationItem[]) => {
    if (!browserPushEnabled || !canUseBrowserNotifications()) {
      return;
    }
    if (permission !== "granted") {
      return;
    }
    if (document.visibilityState === "visible") {
      return;
    }

    for (const item of items) {
      const key = getNotificationKey(item);
      if (seenNotificationKeysRef.current.has(key)) {
        continue;
      }
      seenNotificationKeysRef.current.add(key);

      const now = Date.now();
      sentAtRef.current = sentAtRef.current.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
      if (sentAtRef.current.length >= RATE_LIMIT_MAX_NOTIFICATIONS) {
        continue;
      }
      sentAtRef.current.push(now);

      new Notification(item.title, {
        body: getNotificationBody(item),
        tag: key,
      });
    }
  };

  const requestPushPermission = async () => {
    if (!browserPushEnabled || !canUseBrowserNotifications()) {
      return;
    }
    if (window.Notification.permission !== "default") {
      setPermission(window.Notification.permission);
      return;
    }

    const nextPermission = await window.Notification.requestPermission();
    setPermission(nextPermission);
  };

  const pushButtonLabel = !browserPushEnabled
    ? "Push off"
    : permission === "granted"
      ? "Push on"
      : permission === "denied"
        ? "Push blocked"
        : "Enable push";

  const pushButtonDisabled = !browserPushEnabled || permission === "granted" || permission === "denied";
  const pushPermissionBlocked = browserPushEnabled && permission === "denied";
  const pushPermissionHelp = pushPermissionBlocked ? "Enable notifications in browser site settings, then reload." : undefined;

  return (
    <>
      {realtimeEnabled ? (
        <RealtimeUpdates
          key={activeSlug ?? "all-projects"}
          activeSlug={activeSlug}
          onHasUpdatesChange={setHasUpdates}
          onNotifications={handleIncomingNotifications}
        />
      ) : null}
      <div className="flex h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="flex flex-col">
          <div className="flex items-center justify-end gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <button
              type="button"
              onClick={requestPushPermission}
              disabled={pushButtonDisabled}
              title={pushPermissionHelp}
              aria-label={
                browserPushEnabled
                  ? permission === "granted"
                    ? "Browser push notifications enabled"
                    : permission === "denied"
                      ? "Browser push notifications blocked. Enable notifications in browser site settings, then reload."
                      : "Enable browser push notifications"
                  : "Browser push notifications disabled"
              }
              className={`rounded border border-zinc-300 px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 ${
                pushButtonDisabled ? "cursor-not-allowed opacity-60" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              {pushButtonLabel}
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen((value) => !value)}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
              aria-label={drawerOpen ? "Close notifications" : "Open notifications"}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              aria-controls="notifications-panel"
            >
              <span className="inline-flex items-center gap-2">
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M10 3.5a4 4 0 0 0-4 4V9c0 .86-.28 1.7-.8 2.4L4 13h12l-1.2-1.6A4 4 0 0 1 14 9V7.5a4 4 0 0 0-4-4Z" />
                  <path d="M8 14a2 2 0 0 0 4 0" />
                </svg>
                Notifications
                {notifications.length > 0 ? (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                    {notifications.length}
                  </span>
                ) : null}
              </span>
            </button>
            <RefreshButton hasUpdates={hasUpdates} />
          </div>
          <ProjectSidebar
            projects={projects}
            activeSlug={activeSlug}
            pendingSlug={isPending ? pendingSlug : null}
            onProjectSelect={(slug) => {
              if (slug === activeSlug) {
                return;
              }

              setPendingSlug(slug);
              startTransition(() => {
                router.push(`/projects/${slug}`);
              });
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          {isPending ? (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              className="flex h-screen items-center justify-center p-6"
            >
              <div className="w-full max-w-3xl rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200"
                  />
                  Loading project details…
                </div>
              </div>
            </div>
          ) : (
            children
          )}
        </div>
        <NotificationsPanel notifications={notifications} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotificationsPanel } from "@/components/layout/NotificationsPanel";
import { RealtimeUpdates, type RealtimeNotificationItem } from "@/components/layout/RealtimeUpdates";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ProjectSidebar } from "@/components/projects/ProjectSidebar";
import { shouldShowBrowserDesktopAlert } from "@/lib/notifications/browser-delivery";
import {
  getBrowserNotificationStatus,
  type BrowserNotificationStatus,
  type BrowserNotificationStatusInput,
} from "@/lib/notifications/browser-status";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";
import type { ProjectCard } from "@/lib/services/types";

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_NOTIFICATIONS = 3;
const suppressBrowserNotificationsWhenVisible = true;

type Props = {
  projects: ProjectCard[];
  activeSlug?: string;
  notifications?: ClaudeNotification[];
  notificationBaselineAt?: string;
  children: React.ReactNode;
};

type BrowserRuntimeStatus = Pick<
  BrowserNotificationStatusInput,
  "notificationSupported" | "permission" | "isSecureContext" | "isLocalhost" | "visibilityState"
>;

const DEFAULT_BROWSER_RUNTIME_STATUS: BrowserRuntimeStatus = {
  notificationSupported: false,
  permission: "unsupported",
  isSecureContext: false,
  isLocalhost: false,
  visibilityState: "unknown",
};

function canUseBrowserNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function getBrowserRuntimeStatus(): BrowserRuntimeStatus {
  if (typeof window === "undefined") {
    return DEFAULT_BROWSER_RUNTIME_STATUS;
  }

  const notificationSupported = canUseBrowserNotifications();
  const hostname = window.location.hostname;
  return {
    notificationSupported,
    permission: notificationSupported ? window.Notification.permission : "unsupported",
    isSecureContext: window.isSecureContext,
    isLocalhost: hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1",
    visibilityState: typeof document === "undefined" ? "unknown" : document.visibilityState,
  };
}

function getStatusClass(status: BrowserNotificationStatus): string {
  if (status.severity === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (status.severity === "needs-action") {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300";
  }
  if (status.severity === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
  }
  if (status.severity === "blocked") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

function getNotificationKey(item: { id: string; projectSlug?: string }): string {
  return `${item.projectSlug ?? "global"}:${item.id}`;
}

function getNotificationBody(item: RealtimeNotificationItem): string {
  const project = item.projectLabel ?? item.projectSlug ?? "Unknown project";
  if (item.kind === "task" && item.status) {
    return `${project} · Task ${item.status}`;
  }
  if (item.kind === "alert") {
    return `${project} · ${item.title}`;
  }
  return `${project} · ${item.sessionLabel}`;
}

export function AppShell({ projects, activeSlug, notifications = [], notificationBaselineAt, children }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const realtimeEnabled = process.env.NEXT_PUBLIC_AIPANEL_REALTIME_ENABLED !== "false";
  const browserPushEnabled = process.env.NEXT_PUBLIC_AIPANEL_BROWSER_NOTIFICATIONS_ENABLED !== "false";
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [browserRuntimeStatus, setBrowserRuntimeStatus] = useState<BrowserRuntimeStatus>(
    DEFAULT_BROWSER_RUNTIME_STATUS,
  );
  const seenNotificationKeysRef = useRef<Set<string>>(new Set());
  const sentAtRef = useRef<number[]>([]);

  useEffect(() => {
    if (seenNotificationKeysRef.current.size > 0) {
      return;
    }

    for (const notification of notifications) {
      seenNotificationKeysRef.current.add(getNotificationKey(notification));
    }
  }, [notifications]);

  useEffect(() => {
    const syncBrowserRuntimeStatus = () => {
      setBrowserRuntimeStatus(getBrowserRuntimeStatus());
    };

    syncBrowserRuntimeStatus();
    window.addEventListener("focus", syncBrowserRuntimeStatus);
    document.addEventListener("visibilitychange", syncBrowserRuntimeStatus);
    return () => {
      window.removeEventListener("focus", syncBrowserRuntimeStatus);
      document.removeEventListener("visibilitychange", syncBrowserRuntimeStatus);
    };
  }, []);

  const handleIncomingNotifications = (items: RealtimeNotificationItem[]) => {
    const runtimeStatus = getBrowserRuntimeStatus();
    if (!browserPushEnabled || !runtimeStatus.notificationSupported) {
      return;
    }
    if (runtimeStatus.permission !== "granted") {
      setBrowserRuntimeStatus(runtimeStatus);
      return;
    }
    setBrowserRuntimeStatus(runtimeStatus);

    for (const item of items) {
      const key = getNotificationKey(item);
      if (seenNotificationKeysRef.current.has(key)) {
        continue;
      }
      seenNotificationKeysRef.current.add(key);

      const now = Date.now();
      sentAtRef.current = sentAtRef.current.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
      const rateLimited = sentAtRef.current.length >= RATE_LIMIT_MAX_NOTIFICATIONS;
      if (
        !shouldShowBrowserDesktopAlert({
          realtimeEnabled,
          browserNotificationsEnabled: browserPushEnabled,
          notificationSupported: runtimeStatus.notificationSupported,
          permission: runtimeStatus.permission,
          visibilityState: runtimeStatus.visibilityState,
          suppressWhenVisible: suppressBrowserNotificationsWhenVisible,
          rateLimited,
        })
      ) {
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
      setBrowserRuntimeStatus(getBrowserRuntimeStatus());
      return;
    }
    if (window.Notification.permission !== "default") {
      setBrowserRuntimeStatus(getBrowserRuntimeStatus());
      return;
    }

    await window.Notification.requestPermission();
    setBrowserRuntimeStatus(getBrowserRuntimeStatus());
  };

  const browserNotificationStatus = getBrowserNotificationStatus({
    realtimeEnabled,
    browserNotificationsEnabled: browserPushEnabled,
    ...browserRuntimeStatus,
    suppressWhenVisible: suppressBrowserNotificationsWhenVisible,
  });

  return (
    <>
      {realtimeEnabled ? (
        <RealtimeUpdates
          key={activeSlug ?? "all-projects"}
          activeSlug={activeSlug}
          notificationBaselineAt={notificationBaselineAt}
          onNotifications={handleIncomingNotifications}
        />
      ) : null}
      <div className="flex h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div
          className={`flex h-screen shrink-0 flex-col overflow-hidden transition-[width] md:w-80 ${
            mobileSidebarOpen ? "w-80" : "w-16"
          }`}
        >
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800 md:px-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-zinc-300 text-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800 md:hidden"
              aria-label={mobileSidebarOpen ? "Collapse projects sidebar" : "Expand projects sidebar"}
              aria-expanded={mobileSidebarOpen}
              aria-controls="projects-sidebar"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M3 5h14" />
                <path d="M3 10h14" />
                <path d="M3 15h14" />
              </svg>
            </button>
            <div
              role="status"
              aria-live="polite"
              className={`flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1 text-xs md:flex-none ${getStatusClass(
                browserNotificationStatus,
              )}`}
            >
              <span className="truncate">{browserNotificationStatus.message}</span>
              {browserNotificationStatus.state === "permission-default" ? (
                <button
                  type="button"
                  onClick={requestPushPermission}
                  className="shrink-0 rounded border border-current px-2 py-0.5 font-medium hover:bg-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:hover:bg-black/20"
                >
                  {browserNotificationStatus.actionLabel}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen((value) => !value)}
              className={`relative rounded border border-zinc-300 text-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800 ${
                mobileSidebarOpen
                  ? "inline-flex min-w-0 flex-1 items-center px-3 py-1.5 md:flex-none"
                  : "inline-flex h-9 w-9 items-center justify-center md:h-auto md:w-auto md:px-3 md:py-1.5"
              }`}
              aria-label={drawerOpen ? "Close notifications" : "Open notifications"}
              aria-haspopup="dialog"
              aria-expanded={drawerOpen}
              aria-controls="notifications-panel"
            >
              <span className={`inline-flex items-center gap-2 ${mobileSidebarOpen ? "min-w-0" : ""}`}>
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M10 3.5a4 4 0 0 0-4 4V9c0 .86-.28 1.7-.8 2.4L4 13h12l-1.2-1.6A4 4 0 0 1 14 9V7.5a4 4 0 0 0-4-4Z" />
                  <path d="M8 14a2 2 0 0 0 4 0" />
                </svg>
                <span className={`${mobileSidebarOpen ? "truncate" : "hidden"} md:inline`}>Notifications</span>
                {notifications.length > 0 ? (
                  <span
                    className={`inline-flex items-center justify-center bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 ${
                      mobileSidebarOpen
                        ? "shrink-0 rounded px-1.5 py-0.5 text-xs"
                        : "absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none md:static md:h-auto md:min-w-0 md:rounded md:px-1.5 md:py-0.5 md:text-xs md:leading-normal"
                    }`}
                  >
                    {notifications.length}
                  </span>
                ) : null}
              </span>
            </button>
          </div>
          <ProjectSidebar
            projects={projects}
            activeSlug={activeSlug}
            pendingSlug={isPending ? pendingSlug : null}
            collapsed={!mobileSidebarOpen}
            onProjectSelect={(slug) => {
              if (slug === activeSlug) {
                return;
              }

              setMobileSidebarOpen(false);
              setPendingSlug(slug);
              startTransition(() => {
                router.push(`/projects/${slug}`);
              });
            }}
          />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute right-4 top-4 z-10">
            <ThemeToggle />
          </div>
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

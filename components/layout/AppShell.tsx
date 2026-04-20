"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NotificationsPanel } from "@/components/layout/NotificationsPanel";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { RealtimeUpdates } from "@/components/layout/RealtimeUpdates";
import { ProjectSidebar } from "@/components/projects/ProjectSidebar";
import type { ProjectCard } from "@/lib/services/types";

type NotificationItem = {
  id: string;
  sessionId: string;
  sessionLabel: string;
  createdAt: string;
  kind: "question" | "permission" | "task";
  title: string;
  details?: string;
  status?: string;
};

type Props = {
  projects: ProjectCard[];
  activeSlug?: string;
  notifications?: NotificationItem[];
  children: React.ReactNode;
};

export function AppShell({ projects, activeSlug, notifications = [], children }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const realtimeEnabled = process.env.NEXT_PUBLIC_AIPANEL_REALTIME_ENABLED === "true";
  const [hasUpdates, setHasUpdates] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  return (
    <>
      {realtimeEnabled ? (
        <RealtimeUpdates key={activeSlug ?? "all-projects"} activeSlug={activeSlug} onHasUpdatesChange={setHasUpdates} />
      ) : null}
      <div className="flex h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="flex flex-col">
          <div className="flex items-center justify-end border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
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
        <NotificationsPanel notifications={notifications} />
      </div>
    </>
  );
}

import { useState } from "react";
import { NotificationsPanel } from "@/components/layout/NotificationsPanel";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

type Props = {
  notifications: ClaudeNotification[];
};

export function NotificationBellDrawerGoldStandard({ notifications }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
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
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4" aria-hidden="true">
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

      <NotificationsPanel notifications={notifications} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

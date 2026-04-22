"use client";

import { useEffect, useState } from "react";

export type RealtimeNotificationItem = {
  id: string;
  kind: "question" | "permission" | "task" | "alert";
  title: string;
  createdAt: string;
  projectSlug?: string;
  projectLabel?: string;
  sessionLabel: string;
  status?: string;
};

type Props = {
  activeSlug?: string;
  onHasUpdatesChange?: (hasUpdates: boolean) => void;
  onNotifications?: (items: RealtimeNotificationItem[]) => void;
};

function isRealtimeNotificationItem(value: unknown): value is RealtimeNotificationItem {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<RealtimeNotificationItem>;
  return (
    typeof record.id === "string" &&
    typeof record.kind === "string" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.sessionLabel === "string"
  );
}

export function RealtimeUpdates({ activeSlug, onHasUpdatesChange, onNotifications }: Props) {
  const [hasUpdates, setHasUpdates] = useState(false);

  useEffect(() => {
    onHasUpdatesChange?.(hasUpdates);
  }, [hasUpdates, onHasUpdatesChange]);

  useEffect(() => {
    const url = new URL("/api/realtime", window.location.origin);
    if (activeSlug) {
      url.searchParams.set("activeSlug", activeSlug);
    }

    const eventSource = new EventSource(url);

    const handleUpdate = () => {
      setHasUpdates(true);
    };

    const handleNotification = (event: MessageEvent<string>) => {
      if (!onNotifications) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as { items?: unknown[] };
        if (!Array.isArray(payload.items)) {
          return;
        }

        const items = payload.items.filter(isRealtimeNotificationItem);
        if (items.length > 0) {
          onNotifications(items);
        }
      } catch {
        return;
      }
    };

    eventSource.addEventListener("update", handleUpdate);
    eventSource.addEventListener("notification", handleNotification as EventListener);

    return () => {
      eventSource.removeEventListener("update", handleUpdate);
      eventSource.removeEventListener("notification", handleNotification as EventListener);
      eventSource.close();
    };
  }, [activeSlug, onNotifications]);

  return null;
}

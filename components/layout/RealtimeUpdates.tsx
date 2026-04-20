"use client";

import { useEffect, useState } from "react";

type Props = {
  activeSlug?: string;
  onHasUpdatesChange?: (hasUpdates: boolean) => void;
};

export function RealtimeUpdates({ activeSlug, onHasUpdatesChange }: Props) {
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

    eventSource.addEventListener("update", handleUpdate);

    return () => {
      eventSource.removeEventListener("update", handleUpdate);
      eventSource.close();
    };
  }, [activeSlug]);

  return null;
}

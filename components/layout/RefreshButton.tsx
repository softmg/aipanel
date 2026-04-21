"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  hasUpdates?: boolean;
};

export function RefreshButton({ hasUpdates = false }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onRefresh = async () => {
    setLoading(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const label = loading ? "Refreshing dashboard" : hasUpdates ? "Refresh dashboard with updates" : "Refresh dashboard";

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded border border-zinc-300 text-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
        aria-hidden="true"
      >
        <path d="M16 10a6 6 0 1 1-1.76-4.24" />
        <path d="M16 4v4h-4" />
      </svg>
    </button>
  );
}

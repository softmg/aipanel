"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshButton() {
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

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {loading ? "Refreshing..." : "Refresh"}
    </button>
  );
}

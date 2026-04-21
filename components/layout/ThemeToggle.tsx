"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const storageKey = "aipanel-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem(storageKey);
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  const isDark = mounted && theme === "dark";

  useEffect(() => {
    const initialTheme = getInitialTheme();
    applyTheme(initialTheme);

    const frame = window.requestAnimationFrame(() => {
      setTheme(initialTheme);
      setMounted(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = isDark ? "light" : "dark";
    window.localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
    setTheme(nextTheme);
    setMounted(true);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex h-9 w-9 items-center justify-center rounded border border-zinc-300 bg-white text-sm text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {isDark ? (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 1.8v2M10 16.2v2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M1.8 10h2M16.2 10h2M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M14.5 12.8A6.2 6.2 0 0 1 7.2 5.5 6.2 6.2 0 1 0 14.5 12.8Z" />
        </svg>
      )}
    </button>
  );
}

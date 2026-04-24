"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { formatNumber, formatRelative } from "@/lib/format";
import type { ProjectCard } from "@/lib/services/types";

type Props = {
  projects: ProjectCard[];
  activeSlug?: string;
  pendingSlug?: string | null;
  collapsed?: boolean;
  onProjectSelect?: (slug: string) => void;
};

const PAGE_SIZE = 3;

export function ProjectSidebar({ projects, activeSlug, pendingSlug, collapsed = false, onProjectSelect }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleProjects = useMemo(() => projects.slice(0, visibleCount), [projects, visibleCount]);
  const canLoadMore = visibleCount < projects.length;

  return (
    <nav
      id="projects-sidebar"
      className="h-full w-full border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      aria-label="Projects"
    >
      <div className="border-b border-zinc-200 p-3 dark:border-zinc-800 md:p-4">
        <p className={`text-lg font-semibold ${collapsed ? "sr-only md:not-sr-only" : ""}`}>Projects</p>
        <p className={`text-xs text-zinc-500 ${collapsed ? "sr-only md:not-sr-only" : ""}`}>Session + beads overview</p>
        {collapsed ? <p className="text-center text-xs font-semibold text-zinc-500 md:hidden">PRJ</p> : null}
      </div>

      <div className="max-h-[calc(100vh-72px)] overflow-y-auto p-2">
        {projects.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
            No projects configured. Create <code>projects.json</code> from <code>projects.example.json</code>.
          </div>
        ) : null}

        {visibleProjects.map((project) => {
          const active = project.slug === activeSlug;
          const pending = project.slug === pendingSlug;

          return (
            <Link
              key={project.slug}
              href={`/projects/${project.slug}`}
              aria-current={active ? "page" : undefined}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (!onProjectSelect) {
                  return;
                }

                event.preventDefault();
                onProjectSelect(project.slug);
              }}
              title={collapsed ? project.name : undefined}
              className={`mb-2 block rounded-lg border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 ${
                collapsed ? "p-2 text-center md:p-3 md:text-left" : "p-3"
              } ${
                active
                  ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className={`truncate text-sm font-semibold ${collapsed ? "sr-only md:not-sr-only" : ""}`}>{project.name}</p>
                  {collapsed ? (
                    <span aria-hidden="true" className="mx-auto text-xs font-semibold md:hidden">
                      {project.name.slice(0, 2).toUpperCase()}
                    </span>
                  ) : null}
                  {pending ? (
                    <span
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 dark:border-blue-500/30 dark:border-t-blue-300"
                    />
                  ) : null}
                </div>
                <p suppressHydrationWarning className={`text-[11px] text-zinc-500 ${collapsed ? "hidden md:block" : ""}`}>{formatRelative(project.lastActivityAt)}</p>
              </div>

              <p className={`truncate text-[11px] text-zinc-500 ${collapsed ? "hidden md:block" : ""}`}>{project.absolutePath}</p>

              <div className={`mt-2 space-y-2 text-[11px] text-zinc-600 dark:text-zinc-300 ${collapsed ? "hidden md:block" : ""}`}>
                <p>
                  {project.sessionCount} sessions · {formatNumber(project.totalInputTokens + project.totalOutputTokens)} tokens
                </p>
              </div>

              <div className={`mt-2 flex flex-wrap gap-1 text-[10px] ${collapsed ? "hidden md:flex" : ""}`}>
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                  O {project.beadsCounts.open}
                </span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  IP {project.beadsCounts.in_progress}
                </span>
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                  B {project.beadsCounts.blocked}
                </span>
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                  D {project.beadsCounts.closed}
                </span>
              </div>
            </Link>
          );
        })}

        {canLoadMore ? (
          <button
            type="button"
            onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
            className={`mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-900 ${
              collapsed ? "hidden md:block" : ""
            }`}
          >
            Загрузить ещё
          </button>
        ) : null}
      </div>
    </nav>
  );
}

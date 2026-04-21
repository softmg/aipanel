import Link from "next/link";
import { formatNumber, formatRelative } from "@/lib/format";
import type { ProjectCard } from "@/lib/services/types";

type Props = {
  projects: ProjectCard[];
  activeSlug?: string;
};

export function ProjectSidebar({ projects, activeSlug }: Props) {
  return (
    <nav className="w-80 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-lg font-semibold">Projects</p>
        <p className="text-xs text-zinc-500">Session + beads overview</p>
      </div>

      <div className="max-h-[calc(100vh-72px)] overflow-y-auto p-2">
        {projects.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
            No projects configured. Create <code>projects.json</code> from <code>projects.example.json</code>.
          </div>
        ) : null}

        {projects.map((project) => {
          const active = project.slug === activeSlug;

          return (
            <Link
              key={project.slug}
              href={`/projects/${project.slug}`}
              aria-current={active ? "page" : undefined}
              className={`mb-2 block rounded-lg border p-3 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 ${
                active
                  ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <p className="truncate text-sm font-semibold">{project.name}</p>
                <p suppressHydrationWarning className="text-[11px] text-zinc-500">{formatRelative(project.lastActivityAt)}</p>
              </div>

              <p className="truncate text-[11px] text-zinc-500">{project.absolutePath}</p>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                  in: {formatNumber(project.totalInputTokens)}
                </div>
                <div className="rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                  out: {formatNumber(project.totalOutputTokens)}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
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
      </div>
    </nav>
  );
}

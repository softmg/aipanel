import { RefreshButton } from "@/components/layout/RefreshButton";
import { ProjectSidebar } from "@/components/projects/ProjectSidebar";
import type { ProjectCard } from "@/lib/services/types";

type Props = {
  projects: ProjectCard[];
  activeSlug?: string;
  children: React.ReactNode;
};

export function AppShell({ projects, activeSlug, children }: Props) {
  return (
    <div className="flex h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex flex-col">
        <div className="flex items-center justify-end border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <RefreshButton />
        </div>
        <ProjectSidebar projects={projects} activeSlug={activeSlug} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

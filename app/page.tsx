import { AppShell } from "@/components/layout/AppShell";
import { getProjectCards } from "@/lib/services/aggregator";

export default async function HomePage() {
  const projects = await getProjectCards();

  return (
    <AppShell projects={projects} notifications={[]}>
      <main className="flex h-screen items-center justify-center p-6">
        <div className="max-w-xl rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="mb-2 text-xl font-semibold">AI Project Status Panel</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Select a project from the sidebar to view sessions and beads kanban.
          </p>
          {projects.length === 0 ? (
            <p className="mt-4 rounded bg-amber-100 p-3 text-sm text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
              No projects configured. Create a <code>projects.json</code> file from <code>projects.example.json</code>.
            </p>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

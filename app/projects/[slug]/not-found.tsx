export default function ProjectNotFound() {
  return (
    <main className="flex h-screen items-center justify-center p-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-2 text-xl font-semibold">Project not found</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Check your projects.json configuration and try again.
        </p>
      </div>
    </main>
  );
}

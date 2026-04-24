export default function ProjectPageLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex h-screen items-center justify-center p-6"
    >
      <div className="w-full max-w-3xl rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-700 dark:border-t-zinc-200"
          />
          Loading project details…
        </div>
      </div>
    </main>
  );
}

# AIPanel checks

- Keep adapters read-only; do not mutate external sources.
- Return partial results with `warnings` instead of throwing for optional source outages.
- Validate API route params with zod schemas before data access.
- Prefer project aliases (`@/...`) over long relative imports.
- Keep UI server-first in App Router; use client components only when state/events are required.
- Do not add page-level `"use client"` in app routes for panel pages.
- Tabs must keep semantic roles (`tablist`, `tab`, `tabpanel`) and keyboard-focus-visible styles.
- Partial source failures must render visible warnings with accessible live-region semantics.
- Sidebar and kanban must preserve explicit zero-state placeholders.
- Long titles/summaries should be clamped or truncated to avoid horizontal overflow.
- Final verification must include browser checks for layout, zero states, and warnings.
- Modal/drawer components must set `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, close on Escape, move focus to the close button on open, and provide an accessible backdrop dismissal.
- Task/issue ids in API routes must be validated with a zod regex (e.g. `^[a-z0-9][a-z0-9_-]*$`) before reaching shell adapters.

# AGENTS.md

Instructions for future Codex sessions in this repository.

## Project stack

- Next.js App Router, React, TypeScript
- Tailwind CSS v4
- zod for schema validation
- Vitest for tests
- better-sqlite3 for local SQLite reads
- pnpm for package scripts

## Validation

Run the relevant checks after code changes:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e:smoke
pnpm build
```

После изменений в Telegram daemon можно дополнительно выполнить manual smoke:

```bash
pnpm notify:once --dry-run
```

For larger release/merge checks, run:

```bash
pnpm e2e
```

For small documentation-only edits, `pnpm typecheck` is usually enough unless surrounding code changed.

## Notification architecture

- Current browser/system notifications are open-tab Browser Notification API notifications, not service-worker Web Push.
- Do not call them “push notifications” in UI copy unless true Web Push is implemented.
- Notification sources currently come from Claude Code JSONL-derived `question`, `permission`, `task`, and `alert` notifications.
- `AppShell` owns browser notification permission and client-side delivery.
- `/api/realtime` streams notification events for the active project.
- Local always-on external delivery is handled by `pnpm notify` daemon (`scripts/aipanel-notifier.ts`).
- Daemon sends only human-intervention events (Claude question + task ready for review) for Telegram/macOS channels.
- Daemon must not send permission/tool/Bash/context-threshold alert events to Telegram/macOS channels.
- Keep Telegram bot tokens server-side only.
- Unit tests for macOS channel must use runner injection/mocks and must not invoke real `osascript`.
- If macOS channel is disabled or platform is non-darwin, dispatcher should skip safely.
- Do not store secrets in `localStorage`, client React state, `NEXT_PUBLIC_*` env vars, or repository-tracked files.

## Coding expectations

- Keep changes small and reviewable.
- Preserve existing conventions and typed TypeScript patterns.
- Prefer typed helpers over large inline component logic.
- Prefer small, testable helpers in `lib/**`; Vitest includes `lib/**/*.test.ts` and `app/api/**/*.test.ts`.
- Add or update tests for behavior changes.
- Validate route params and config with zod where applicable.
- For UI changes, verify behavior in a browser before reporting completion.

## Repository workflow

- Use `bd` beads for project task tracking when the session requires tracking.
- Do not modify `.claude/settings.json` or `project.md` unless explicitly asked.
- Do not commit or push unless explicitly requested by the user.

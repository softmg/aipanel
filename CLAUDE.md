# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev
```

## Claude Skill Stack

- Use beads (`bd`) as the only project task tracker; do not use markdown TODO lists or Claude task lists for project work.
- Use `claude-mem` skills for prior-session context and timeline/history questions.
- Use Serena or structural exploration skills before reading large files.
- Use `agent-teams-sm` for substantial multi-file feature work and `.conventions/` maintenance.
- Use Playwright/browser verification for UI changes before reporting completion.
- Use `review`, `security-review`, and `simplify` for final quality checks when appropriate.
- Do not use `bishx` workflows in this project; they overlap with beads, `agent-teams-sm`, `claude-mem`, and built-in review flows.

## Architecture Overview

- Next.js App Router UI with server-rendered pages and client-only interactive controls.
- `lib/config` loads and validates `projects.json`.
- `lib/sources/*` reads data from Claude JSONL logs, claude-mem SQLite, and beads CLI.
- `lib/services/aggregator.ts` merges all source data into project cards and project detail DTOs.
- `app/api/*` exposes read-only endpoints for projects and cache refresh.

## Conventions & Patterns

- Keep source adapters read-only and return empty arrays on source unavailability.
- Surface partial source failures through `warnings` in aggregated project detail.
- Validate route params with zod in API handlers.
- Use `@/...` imports and strict TypeScript types.
- Store reusable conventions in `.conventions/` and keep them updated with new features.

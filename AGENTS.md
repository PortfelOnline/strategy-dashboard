# AGENTS.md — Codex Guide for `strategy-dashboard`

## Purpose
- Project: AI content generation dashboard (`get-my-agent.com`).
- Goal for agents: maintain stable full-stack behavior across client/server/shared code.

## Repository Map
- `client/src/` — React frontend.
- `server/` — Express + tRPC backend.
- `shared/` — shared types/constants.
- `drizzle/` — DB migrations.

## Working Rules
- Do not edit `CLAUDE.md` in this repository.
- Keep client/server contract changes synchronized (`server` + `shared` + client usage).
- For DB/schema changes, include migration impact and backward-compatibility notes.
- Avoid changing runtime ports/env assumptions unless explicitly requested.

## Verify Before Claiming Done
- Run:
  - `npm run check`
  - `npm run test`
  - `npm run build`
- If DB-related files changed, run relevant Drizzle command flow used in this repo.

## Additional Context
- For Meta integration and content logic, inspect:
  - `server/meta.db.ts`
  - `server/routers/`

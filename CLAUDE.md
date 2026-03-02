# strategy-dashboard — AI Content Generation Dashboard

**Project:** get-my-agent.com — AI-powered social media content for the Indian market
**Stack:** React + Vite (client), Express + tRPC (server), Drizzle ORM, TypeScript
**Runtime:** Node.js via `tsx`

## Structure
- `client/src/` — React frontend (Vite, shadcn/ui, Radix, TanStack Query)
- `server/` — Express backend with tRPC routers
  - `server/_core/` — app entry point and core config
  - `server/routers/` — tRPC route handlers
  - `server/db.ts` — database connection (Drizzle)
  - `server/storage.ts` — S3/file storage
  - `server/meta.db.ts` — Meta API integration
- `shared/` — shared types and constants used by both client and server
- `drizzle/` — DB migrations

## How to work
- Dev: `npm run dev` (starts server with tsx watch on port configured in `_core/index.ts`)
- Build: `npm run build` (Vite + esbuild)
- TypeCheck: `npm run check`
- Tests: `npm run test` (Vitest)
- DB migrations: `npm run db:push`
- Format: `npm run format` (Prettier)

## Key context
- Meta API (Facebook/Instagram) integration — see `server/meta.db.ts` and `server/routers/`
- Auth: OAuth 2.0 for Meta accounts
- AI content generation via LLM — see server routers for prompt logic
- Multi-language: Hinglish, Hindi, English, Tamil, Telugu, Bengali

## Agent guide
- For cross-project agent behavior (commands, skills, MCP, rules, settings) see `docs/agent/AGENT_GUIDE.md`.

## Cursor scoped rules
Path-scoped guidance for `client/`, `server/`, `drizzle/`, and `shared/` lives in `.cursor/rules/`.

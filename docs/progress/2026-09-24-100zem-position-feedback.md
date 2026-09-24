# 100zem position feedback — progress

## Delivered

- Normalized 28-day Google snapshots, top-50 queries, and persisted improvement cycles.
- Deterministic scoring with a three-URL cap, `/reestr/` exclusion, URL cooldown, and hypothesis cooldown after a loss.
- Publish confirmation requires both WordPress update and origin-cache purge; failed publish remains queued.
- Delayed 21/28-day outcome evaluation with `won`, `lost`, and `inconclusive` states.
- Read-only cycles table in Article Analyzer.
- Production schema contains `seo_page_snapshots`, `seo_page_queries`, and `seo_improvement_cycles`; migration `0012` is recorded in `__drizzle_migrations`.

## Production rollout

- Dashboard app was rebuilt and restarted successfully.
- `SEO_POSITION_FEEDBACK_ENABLED` remains unset/disabled as of this entry.
- Article scheduler is enabled and configured for three articles per night; enabling the feedback flag would therefore permit the next scheduled feedback batch.
- Production backups are under `/root/backups/strategy-dashboard-seo-*` and `/root/backups/strategy-dashboard-seo-migration-*`.

## Verification

- 23 targeted Vitest tests pass.
- `npm run build` passes locally and in the production Docker build.
- The dashboard app is running; unauthenticated root requests correctly receive HTTP 401.

## Follow-up

Perform a supervised dry-run before setting `SEO_POSITION_FEEDBACK_ENABLED=1`. Confirm no `/reestr/` URL and no more than three candidates, then review the first published cycles and their snapshots.

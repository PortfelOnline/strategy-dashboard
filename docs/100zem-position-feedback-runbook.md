# 100zem position feedback rollout

## Safety default

The loop is disabled unless `SEO_POSITION_FEEDBACK_ENABLED=1` is set. With the
flag unset or `0`, the existing nightly queue and its batch size are unchanged.

When enabled, the feedback path selects at most three non-`/reestr/` URLs. It
stores normalized 28-day Google snapshots, creates a `queued` cycle before a
rewrite, and marks it `published` only after WordPress update and origin cache
purge both complete. A failed publish stays queued without a cooldown.

## Prerequisites

1. Resolve the pre-existing Drizzle history ambiguity between `backlink_posts`
   and `backlinkPosts` before applying migrations automatically. Do not use a
   generated migration that contains unrelated rename/drop statements.
2. Apply only reviewed migration `drizzle/0012_seo_position_feedback.sql` once
   the migration history is reconciled and backed up.
3. Confirm `GSC_SITE_URLS` contains both relevant properties during the domain
   transition. Credentials must remain outside git.

## Dry run and first enablement

1. Keep `SEO_POSITION_FEEDBACK_ENABLED=0` while deploying the code.
2. Verify normal scheduler operation and the migration state.
3. Set `SEO_POSITION_FEEDBACK_ENABLED=1` for one supervised scheduler run.
4. Inspect `seo_page_snapshots` and `seo_improvement_cycles`: there must be no
   `/reestr/` cycle and no more than three new queued/published cycles.
5. Confirm each published cycle has a non-null `published_at`, two SHA-256
   hashes, and a `next_measurement_at`; failed URLs must remain queued.

## Outcome review

At 21 days cycles become `measuring`; at 28 days comparable windows are scored.
Fewer than 100 impressions in either window is always `inconclusive`. A loss
receives a 90-day cooldown for its hypothesis. Outcomes do not automatically
trigger another rewrite.

## Rollback

Set `SEO_POSITION_FEEDBACK_ENABLED=0` and restart only the dashboard service
through the normal deployment process. This stops new feedback work immediately
without deleting snapshots or cycles; keep those records for diagnosis.

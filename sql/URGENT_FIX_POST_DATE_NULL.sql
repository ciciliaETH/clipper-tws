-- ============================================================
-- FIX: Allow NULL in post_date column (Instagram)
-- ============================================================
-- Instagram aggregator may not have timestamps, so we allow NULL
-- Backfill endpoint will populate these later

-- Make post_date nullable in instagram_posts_daily
ALTER TABLE instagram_posts_daily 
  ALTER COLUMN post_date DROP NOT NULL;

-- Verify change
SELECT 
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'instagram_posts_daily'
  AND column_name IN ('post_date', 'taken_at');

-- Expected result:
-- post_date    | YES | date            ← Can be NULL now!
-- taken_at     | YES | timestamptz      ← Can be NULL now!

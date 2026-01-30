-- URGENT FIX: Allow NULL in tiktok_posts_daily.post_date column
-- Issue: Aggregator doesn't provide post_date, code derives it from taken_at
-- If taken_at exists, post_date is derived. This allows flexibility.

-- Allow NULL in post_date column
ALTER TABLE tiktok_posts_daily 
  ALTER COLUMN post_date DROP NOT NULL;

-- Verify the change
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'tiktok_posts_daily' 
  AND column_name IN ('post_date', 'taken_at');

-- Expected result:
-- post_date    | YES | date
-- taken_at     | YES | timestamp with time zone

-- Note: Code now includes post_date in upserts, derived from taken_at
-- All future data will have post_date populated
-- This allows NULL for legacy data or edge cases

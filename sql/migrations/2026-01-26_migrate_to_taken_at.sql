-- Migration: Replace post_date (DATE) with taken_at (TIMESTAMPTZ)
-- Date: 2026-01-26
-- Impact: All queries now use precise timestamps instead of dates
-- Reason: Better accuracy for accrual calculations and video tracking

BEGIN;

-- ========================================
-- STEP 1: Add taken_at column to tiktok_posts_daily
-- ========================================
ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

-- Backfill: Convert post_date to taken_at (midnight UTC)
UPDATE public.tiktok_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL AND post_date IS NOT NULL;

-- Create index on taken_at
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_taken_at 
  ON public.tiktok_posts_daily(taken_at);

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username_taken_at 
  ON public.tiktok_posts_daily(username, taken_at);

-- ========================================
-- STEP 2: Add taken_at column to instagram_posts_daily
-- ========================================
-- Note: instagram_posts_daily already has taken_at from 2026-01-09 migration
-- Backfill if any rows missing
UPDATE public.instagram_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL AND post_date IS NOT NULL;

-- Create indexes on taken_at
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_taken_at 
  ON public.instagram_posts_daily(taken_at);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_username_taken_at 
  ON public.instagram_posts_daily(username, taken_at);

-- ========================================
-- STEP 3: Update views that reference post_date
-- ========================================

-- Drop and recreate group_leaderboard view if exists
DROP VIEW IF EXISTS public.group_leaderboard CASCADE;

-- Note: group_leaderboard will be recreated if needed by application logic
-- or can be removed entirely if unused (see cleanup script)

-- ========================================
-- STEP 4: Verify data integrity
-- ========================================

-- Check for NULL taken_at values in TikTok
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.tiktok_posts_daily
  WHERE taken_at IS NULL;
  
  IF null_count > 0 THEN
    RAISE WARNING 'Found % rows with NULL taken_at in tiktok_posts_daily', null_count;
  ELSE
    RAISE NOTICE 'All tiktok_posts_daily rows have taken_at values';
  END IF;
END $$;

-- Check for NULL taken_at values in Instagram
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.instagram_posts_daily
  WHERE taken_at IS NULL;
  
  IF null_count > 0 THEN
    RAISE WARNING 'Found % rows with NULL taken_at in instagram_posts_daily', null_count;
  ELSE
    RAISE NOTICE 'All instagram_posts_daily rows have taken_at values';
  END IF;
END $$;

-- ========================================
-- STEP 5: Add NOT NULL constraint after backfill
-- ========================================

-- Set NOT NULL constraint on taken_at (after verifying all data is backfilled)
-- Uncomment these after confirming all data is migrated:
-- ALTER TABLE public.tiktok_posts_daily 
--   ALTER COLUMN taken_at SET NOT NULL;

-- ALTER TABLE public.instagram_posts_daily 
--   ALTER COLUMN taken_at SET NOT NULL;

COMMIT;

-- ========================================
-- STEP 6: Drop post_date columns (DANGEROUS - Run separately after testing!)
-- ========================================
-- WARNING: Only run this after confirming all application code is updated
-- and tested in production for at least 1 week

-- BEGIN;
-- 
-- -- Drop old indexes on post_date
-- DROP INDEX IF EXISTS public.idx_tiktok_posts_daily_post_date;
-- DROP INDEX IF EXISTS public.idx_tiktok_posts_daily_username_post_date;
-- DROP INDEX IF EXISTS public.idx_instagram_posts_daily_post_date;
-- DROP INDEX IF EXISTS public.idx_instagram_posts_daily_user_date;
-- 
-- -- Drop post_date columns
-- ALTER TABLE public.tiktok_posts_daily DROP COLUMN IF EXISTS post_date;
-- ALTER TABLE public.instagram_posts_daily DROP COLUMN IF EXISTS post_date;
-- 
-- COMMIT;

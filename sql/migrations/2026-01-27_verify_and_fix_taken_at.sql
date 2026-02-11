-- Verification and Fix Script: Ensure all taken_at columns are populated
-- Date: 2026-01-27
-- Purpose: Verify migration success and fix any NULL taken_at values

BEGIN;

-- ========================================
-- STEP 1: Comprehensive Backfill for TikTok
-- ========================================

-- First attempt: Use post_date if available
UPDATE public.tiktok_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL 
  AND post_date IS NOT NULL;

-- Second attempt: For remaining NULLs, try to parse from video metadata
-- If still NULL after post_date backfill, set to creation timestamp
UPDATE public.tiktok_posts_daily
SET taken_at = created_at
WHERE taken_at IS NULL 
  AND created_at IS NOT NULL;

-- Last resort: Use current timestamp (rare case)
UPDATE public.tiktok_posts_daily
SET taken_at = NOW()
WHERE taken_at IS NULL;

-- ========================================
-- STEP 2: Comprehensive Backfill for Instagram
-- ========================================

-- First attempt: Use post_date if available
UPDATE public.instagram_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL 
  AND post_date IS NOT NULL;

-- Second attempt: Use created_at if available
UPDATE public.instagram_posts_daily
SET taken_at = created_at
WHERE taken_at IS NULL 
  AND created_at IS NOT NULL;

-- Last resort: Use current timestamp
UPDATE public.instagram_posts_daily
SET taken_at = NOW()
WHERE taken_at IS NULL;

-- ========================================
-- STEP 3: Add NOT NULL constraint (after backfill)
-- ========================================

-- Set default for future inserts
ALTER TABLE public.tiktok_posts_daily
  ALTER COLUMN taken_at SET DEFAULT NOW();

ALTER TABLE public.instagram_posts_daily
  ALTER COLUMN taken_at SET DEFAULT NOW();

-- Add NOT NULL constraint (only after all data is backfilled)
-- Uncomment after verifying no NULL values remain:
-- ALTER TABLE public.tiktok_posts_daily
--   ALTER COLUMN taken_at SET NOT NULL;

-- ALTER TABLE public.instagram_posts_daily
--   ALTER COLUMN taken_at SET NOT NULL;

-- ========================================
-- STEP 4: Verification Report
-- ========================================

DO $$
DECLARE
  tt_total INTEGER;
  tt_null INTEGER;
  tt_filled INTEGER;
  ig_total INTEGER;
  ig_null INTEGER;
  ig_filled INTEGER;
BEGIN
  -- TikTok stats
  SELECT COUNT(*) INTO tt_total FROM public.tiktok_posts_daily;
  SELECT COUNT(*) INTO tt_null FROM public.tiktok_posts_daily WHERE taken_at IS NULL;
  tt_filled := tt_total - tt_null;
  
  -- Instagram stats
  SELECT COUNT(*) INTO ig_total FROM public.instagram_posts_daily;
  SELECT COUNT(*) INTO ig_null FROM public.instagram_posts_daily WHERE taken_at IS NULL;
  ig_filled := ig_total - ig_null;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'VERIFICATION REPORT: taken_at Migration';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'TikTok Posts:';
  RAISE NOTICE '  Total rows: %', tt_total;
  RAISE NOTICE '  Filled taken_at: % (%.2f%%)', tt_filled, (tt_filled::float / NULLIF(tt_total, 0) * 100);
  RAISE NOTICE '  NULL taken_at: % (%.2f%%)', tt_null, (tt_null::float / NULLIF(tt_total, 0) * 100);
  RAISE NOTICE '';
  RAISE NOTICE 'Instagram Posts:';
  RAISE NOTICE '  Total rows: %', ig_total;
  RAISE NOTICE '  Filled taken_at: % (%.2f%%)', ig_filled, (ig_filled::float / NULLIF(ig_total, 0) * 100);
  RAISE NOTICE '  NULL taken_at: % (%.2f%%)', ig_null, (ig_null::float / NULLIF(ig_total, 0) * 100);
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  
  IF tt_null > 0 THEN
    RAISE WARNING 'TikTok: % rows still have NULL taken_at!', tt_null;
  ELSE
    RAISE NOTICE '✓ TikTok: All rows have taken_at populated';
  END IF;
  
  IF ig_null > 0 THEN
    RAISE WARNING 'Instagram: % rows still have NULL taken_at!', ig_null;
  ELSE
    RAISE NOTICE '✓ Instagram: All rows have taken_at populated';
  END IF;
  
  RAISE NOTICE '========================================';
END $$;

-- ========================================
-- STEP 5: Sample Data Check
-- ========================================

-- Show sample TikTok data
DO $$ BEGIN RAISE NOTICE 'Sample TikTok data (first 5 rows):'; END $$;
SELECT 
  video_id,
  username,
  post_date,
  taken_at,
  CASE 
    WHEN taken_at IS NULL THEN 'NULL'
    ELSE '✓'
  END as status
FROM public.tiktok_posts_daily
ORDER BY created_at DESC
LIMIT 5;

-- Show sample Instagram data
DO $$ BEGIN RAISE NOTICE 'Sample Instagram data (first 5 rows):'; END $$;
SELECT 
  id,
  username,
  post_date,
  taken_at,
  CASE 
    WHEN taken_at IS NULL THEN 'NULL'
    ELSE '✓'
  END as status
FROM public.instagram_posts_daily
ORDER BY created_at DESC
LIMIT 5;

COMMIT;

-- ========================================
-- MANUAL VERIFICATION QUERIES
-- ========================================

-- Run these separately to check specific cases:

-- 1. Check for any NULL taken_at in TikTok
-- SELECT COUNT(*) as null_count FROM tiktok_posts_daily WHERE taken_at IS NULL;

-- 2. Check for any NULL taken_at in Instagram
-- SELECT COUNT(*) as null_count FROM instagram_posts_daily WHERE taken_at IS NULL;

-- 3. Compare post_date vs taken_at
-- SELECT 
--   video_id,
--   post_date,
--   taken_at,
--   taken_at::date as taken_at_date,
--   CASE WHEN post_date = taken_at::date THEN '✓' ELSE 'MISMATCH' END as match
-- FROM tiktok_posts_daily
-- WHERE post_date IS NOT NULL
-- LIMIT 20;

-- 4. Check recent inserts (ensure new data uses taken_at)
-- SELECT * FROM tiktok_posts_daily ORDER BY created_at DESC LIMIT 10;
-- SELECT * FROM instagram_posts_daily ORDER BY created_at DESC LIMIT 10;

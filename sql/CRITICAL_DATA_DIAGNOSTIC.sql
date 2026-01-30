-- ============================================================
-- CRITICAL DATA DIAGNOSTIC - WHERE IS THE POSTS DATA?
-- ============================================================
-- Run this entire file in Supabase SQL Editor to find where your Posts data actually lives

-- ============================================================
-- 1. CHECK ALL POSTS TABLES ROW COUNTS
-- ============================================================
DO $$
DECLARE
  tiktok_daily_count INT;
  instagram_daily_count INT;
BEGIN
  -- Always check post_daily tables (these should exist)
  SELECT COUNT(*) INTO tiktok_daily_count FROM tiktok_posts_daily;
  SELECT COUNT(*) INTO instagram_daily_count FROM instagram_posts_daily;
  
  RAISE NOTICE '=== ROW COUNTS ===';
  RAISE NOTICE 'tiktok_posts_daily: % rows', tiktok_daily_count;
  RAISE NOTICE 'instagram_posts_daily: % rows', instagram_daily_count;
  
  -- Check legacy tables only if they exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tiktok_posts') THEN
    EXECUTE 'SELECT COUNT(*) FROM tiktok_posts' INTO tiktok_daily_count;
    RAISE NOTICE 'tiktok_posts (legacy): % rows', tiktok_daily_count;
  ELSE
    RAISE NOTICE 'tiktok_posts: does not exist (good - using daily table)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_posts') THEN
    EXECUTE 'SELECT COUNT(*) FROM instagram_posts' INTO instagram_daily_count;
    RAISE NOTICE 'instagram_posts (legacy): % rows', instagram_daily_count;
  ELSE
    RAISE NOTICE 'instagram_posts: does not exist (good - using daily table)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_posts_daily_norm') THEN
    EXECUTE 'SELECT COUNT(*) FROM instagram_posts_daily_norm' INTO tiktok_daily_count;
    RAISE NOTICE 'instagram_posts_daily_norm: % rows', tiktok_daily_count;
  ELSE
    RAISE NOTICE 'instagram_posts_daily_norm: does not exist';
  END IF;
END $$;

-- ============================================================
-- 2. LIST ALL TABLES WITH 'POST' IN NAME
-- ============================================================
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE '%post%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================================
-- 3. CHECK COLUMNS IN POST_DAILY TABLES
-- ============================================================
SELECT 
  'tiktok_posts_daily' as table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'tiktok_posts_daily'
  AND column_name IN ('post_date', 'taken_at', 'video_id', 'username')
UNION ALL
SELECT 
  'instagram_posts_daily',
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'instagram_posts_daily'
  AND column_name IN ('post_date', 'taken_at', 'id', 'username');

-- ============================================================
-- 4. SAMPLE DATA FROM TIKTOK_POSTS_DAILY
-- ============================================================
SELECT 
  video_id,
  username,
  taken_at,
  play_count,
  digg_count,
  share_count,
  comment_count,
  created_at
FROM tiktok_posts_daily
ORDER BY taken_at DESC
LIMIT 10;

-- ============================================================
-- 5. SAMPLE DATA FROM INSTAGRAM_POSTS_DAILY
-- ============================================================
SELECT 
  id,
  username,
  taken_at,
  like_count,
  comment_count,
  created_at
FROM instagram_posts_daily
ORDER BY taken_at DESC
LIMIT 10;

-- ============================================================
-- 6. CHECK FOR LEGACY DATA IN NON-DAILY TABLES (IF THEY EXIST)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tiktok_posts') THEN
    RAISE NOTICE 'tiktok_posts table EXISTS - run cleanup script to remove it';
  ELSE
    RAISE NOTICE 'tiktok_posts table DOES NOT EXIST (good - using tiktok_posts_daily)';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_posts') THEN
    RAISE NOTICE 'instagram_posts table EXISTS - run cleanup script to remove it';
  ELSE
    RAISE NOTICE 'instagram_posts table DOES NOT EXIST (good - using instagram_posts_daily)';
  END IF;
END $$;

-- ============================================================
-- 7. CHECK RECENT DATA (LAST 7 DAYS)
-- ============================================================
SELECT 
  'tiktok_posts_daily' as table_name,
  DATE(taken_at) as date,
  COUNT(*) as posts_count
FROM tiktok_posts_daily
WHERE taken_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(taken_at)
ORDER BY date DESC;

SELECT 
  'instagram_posts_daily' as table_name,
  DATE(taken_at) as date,
  COUNT(*) as posts_count
FROM instagram_posts_daily
WHERE taken_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(taken_at)
ORDER BY date DESC;

-- ============================================================
-- 8. CHECK IF DATA WAS BACKFILLED FROM POST_DATE TO TAKEN_AT
-- ============================================================
-- Count rows where taken_at is midnight (indicates backfill from post_date)
SELECT 
  'tiktok_posts_daily' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN taken_at::time = '00:00:00' THEN 1 END) as midnight_rows,
  ROUND(100.0 * COUNT(CASE WHEN taken_at::time = '00:00:00' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as midnight_percentage
FROM tiktok_posts_daily
UNION ALL
SELECT 
  'instagram_posts_daily',
  COUNT(*),
  COUNT(CASE WHEN taken_at::time = '00:00:00' THEN 1 END),
  ROUND(100.0 * COUNT(CASE WHEN taken_at::time = '00:00:00' THEN 1 END) / NULLIF(COUNT(*), 0), 2)
FROM instagram_posts_daily;

-- ============================================================
-- 9. FINAL SUMMARY
-- ============================================================
DO $$
DECLARE
  tiktok_count INT;
  instagram_count INT;
BEGIN
  SELECT COUNT(*) INTO tiktok_count FROM tiktok_posts_daily;
  SELECT COUNT(*) INTO instagram_count FROM instagram_posts_daily;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== FINAL SUMMARY ===';
  RAISE NOTICE 'tiktok_posts_daily: % rows', tiktok_count;
  RAISE NOTICE 'instagram_posts_daily: % rows', instagram_count;
  
  IF tiktok_count = 0 AND instagram_count = 0 THEN
    RAISE WARNING '⚠️ POST_DAILY TABLES ARE EMPTY - Need to run refresh-all endpoints!';
  ELSIF tiktok_count > 0 OR instagram_count > 0 THEN
    RAISE NOTICE '✅ POST_DAILY TABLES HAVE DATA - System working correctly!';
  END IF;
  
  -- Check if legacy tables exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tiktok_posts') THEN
    RAISE NOTICE 'ℹ️ Legacy table tiktok_posts still exists - run cleanup script';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_posts') THEN
    RAISE NOTICE 'ℹ️ Legacy table instagram_posts still exists - run cleanup script';
  END IF;
END $$;

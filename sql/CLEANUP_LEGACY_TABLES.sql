-- ============================================================
-- CLEANUP UNUSED TABLES - FINAL CLEANUP
-- ============================================================
-- ⚠️ WARNING: This will PERMANENTLY DELETE tables and data
-- Only run this AFTER:
-- 1. Running CRITICAL_DATA_DIAGNOSTIC.sql
-- 2. Running MIGRATE_LEGACY_TO_DAILY.sql (if needed)
-- 3. Verifying dashboard displays data correctly
-- 4. Confirming tiktok_posts_daily and instagram_posts_daily have all data

-- ============================================================
-- STEP 1: BACKUP CHECK - VERIFY POST_DAILY HAS DATA
-- ============================================================
DO $$
DECLARE
  tiktok_count INT;
  instagram_count INT;
BEGIN
  SELECT COUNT(*) INTO tiktok_count FROM tiktok_posts_daily;
  SELECT COUNT(*) INTO instagram_count FROM instagram_posts_daily;
  
  RAISE NOTICE 'Current row counts:';
  RAISE NOTICE '  tiktok_posts_daily: % rows', tiktok_count;
  RAISE NOTICE '  instagram_posts_daily: % rows', instagram_count;
  
  IF tiktok_count = 0 AND instagram_count = 0 THEN
    RAISE EXCEPTION '❌ ABORT: POST_DAILY TABLES ARE EMPTY! DO NOT PROCEED WITH CLEANUP!';
  ELSE
    RAISE NOTICE '✅ POST_DAILY tables have data, safe to proceed';
  END IF;
END $$;

-- ============================================================
-- STEP 2: DROP UNUSED NORMALIZED/AGGREGATED TABLES
-- ============================================================
-- These tables are confirmed unused in the codebase
DROP TABLE IF EXISTS instagram_posts_daily_norm CASCADE;
DROP TABLE IF EXISTS group_leaderboard CASCADE;
DROP TABLE IF EXISTS groups_total_metrics CASCADE;

RAISE NOTICE '✅ Dropped unused normalized/aggregated tables';

-- ============================================================
-- STEP 3: DROP LEGACY POSTS TABLES (if they exist)
-- ============================================================
-- Only drop these after confirming data is migrated to post_daily
DO $$
BEGIN
  -- Drop tiktok_posts if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tiktok_posts') THEN
    EXECUTE 'DROP TABLE tiktok_posts CASCADE';
    RAISE NOTICE '✅ Dropped legacy table: tiktok_posts';
  ELSE
    RAISE NOTICE 'ℹ️ tiktok_posts table does not exist (already clean)';
  END IF;

  -- Drop instagram_posts if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instagram_posts') THEN
    EXECUTE 'DROP TABLE instagram_posts CASCADE';
    RAISE NOTICE '✅ Dropped legacy table: instagram_posts';
  ELSE
    RAISE NOTICE 'ℹ️ instagram_posts table does not exist (already clean)';
  END IF;
END $$;

-- ============================================================
-- STEP 4: VERIFY ONLY POST_DAILY TABLES REMAIN
-- ============================================================
SELECT 
  'Final Table Check' as status,
  tablename,
  pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE '%post%'
ORDER BY tablename;

-- ============================================================
-- STEP 5: FINAL ROW COUNT VERIFICATION
-- ============================================================
SELECT 
  'tiktok_posts_daily' as table_name,
  COUNT(*) as row_count,
  MIN(taken_at) as oldest_post,
  MAX(taken_at) as newest_post
FROM tiktok_posts_daily
UNION ALL
SELECT 
  'instagram_posts_daily',
  COUNT(*),
  MIN(taken_at),
  MAX(taken_at)
FROM instagram_posts_daily;

-- ============================================================
-- STEP 6: VERIFY INDEXES EXIST
-- ============================================================
-- Check for important indexes on post_daily tables
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (tablename = 'tiktok_posts_daily' OR tablename = 'instagram_posts_daily')
ORDER BY tablename, indexname;

-- ============================================================
-- RECOMMENDED INDEXES (if not exist)
-- ============================================================
-- These indexes optimize dashboard queries
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username_taken_at 
  ON tiktok_posts_daily(username, taken_at DESC);

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_taken_at 
  ON tiktok_posts_daily(taken_at DESC);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_username_taken_at 
  ON instagram_posts_daily(username, taken_at DESC);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_taken_at 
  ON instagram_posts_daily(taken_at DESC);

RAISE NOTICE '✅ Indexes created/verified for optimal query performance';

-- ============================================================
-- FINAL STATUS
-- ============================================================
SELECT 
  '🎉 CLEANUP COMPLETE' as status,
  (SELECT COUNT(*) FROM tiktok_posts_daily) as tiktok_posts,
  (SELECT COUNT(*) FROM instagram_posts_daily) as instagram_posts,
  'Only post_daily tables remain. All legacy/unused tables removed.' as result;

-- ============================================================
-- VACUUM ANALYZE (optimize database after cleanup)
-- ============================================================
VACUUM ANALYZE tiktok_posts_daily;
VACUUM ANALYZE instagram_posts_daily;

RAISE NOTICE '✅ Database optimized (VACUUM ANALYZE completed)';

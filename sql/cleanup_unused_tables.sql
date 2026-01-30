-- CLEANUP SCRIPT: Drop unused tables and ensure all endpoints use post_daily

-- ========================================
-- STEP 1: VERIFY FIRST (DO NOT RUN THIS SECTION YET!)
-- ========================================
-- Run diagnostic_posts_tables.sql FIRST to confirm which tables are safe to drop

-- ========================================
-- STEP 2: BACKUP DATA (SAFETY FIRST!)
-- ========================================
-- If tiktok_posts or instagram_posts have data, backup first:
-- CREATE TABLE tiktok_posts_backup AS SELECT * FROM tiktok_posts;
-- CREATE TABLE instagram_posts_backup AS SELECT * FROM instagram_posts;

-- ========================================
-- STEP 3: DROP UNUSED/DUPLICATE TABLES
-- ========================================

-- Drop normalized table (if exists and unused)
DROP TABLE IF EXISTS instagram_posts_daily_norm CASCADE;

-- Drop aggregated tables (if exists and unused)
DROP TABLE IF EXISTS group_leaderboard CASCADE;
DROP TABLE IF EXISTS groups_total_metrics CASCADE;

-- Drop legacy posts tables (ONLY if confirmed unused and data migrated to post_daily)
-- ⚠️ UNCOMMENT ONLY AFTER VERIFICATION!
-- DROP TABLE IF EXISTS tiktok_posts CASCADE;
-- DROP TABLE IF EXISTS instagram_posts CASCADE;

-- ========================================
-- STEP 4: VERIFY POST_DAILY TABLES EXIST AND HAVE CORRECT STRUCTURE
-- ========================================

-- Ensure tiktok_posts_daily has correct columns
DO $$
BEGIN
  -- Check if taken_at exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tiktok_posts_daily' 
    AND column_name = 'taken_at'
  ) THEN
    RAISE EXCEPTION 'tiktok_posts_daily is missing taken_at column!';
  END IF;
  
  -- Check if post_date still exists (should be dropped after migration)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tiktok_posts_daily' 
    AND column_name = 'post_date'
  ) THEN
    RAISE NOTICE 'tiktok_posts_daily still has post_date column (can be dropped after full migration)';
  END IF;
END $$;

-- ========================================
-- STEP 5: CHECK DATA COUNTS AFTER CLEANUP
-- ========================================

SELECT 
  'tiktok_posts_daily' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT username) as unique_users,
  MIN(taken_at) as earliest_post,
  MAX(taken_at) as latest_post
FROM tiktok_posts_daily;

SELECT 
  'instagram_posts_daily' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT username) as unique_users,
  MIN(taken_at) as earliest_post,
  MAX(taken_at) as latest_post
FROM instagram_posts_daily;

-- ========================================
-- STEP 6: LIST REMAINING TABLES
-- ========================================

SELECT 
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name)::regclass)) as size,
  (SELECT COUNT(*) FROM information_schema.columns WHERE columns.table_name = tables.table_name) as column_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%post%'
ORDER BY table_name;

-- ========================================
-- EXPECTED RESULT AFTER CLEANUP:
-- ========================================
-- Should only have:
-- ✅ tiktok_posts_daily (with taken_at)
-- ✅ instagram_posts_daily (with taken_at)
--
-- Dropped:
-- ❌ instagram_posts_daily_norm
-- ❌ group_leaderboard  
-- ❌ groups_total_metrics
-- ❌ tiktok_posts (if confirmed safe)
-- ❌ instagram_posts (if confirmed safe)

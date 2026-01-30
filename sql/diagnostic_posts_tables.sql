-- DIAGNOSTIC QUERY: Check all posts-related tables and their row counts
-- Run this in Supabase SQL Editor to find where the data is coming from

-- ========================================
-- 1. CHECK POSTS_DAILY TABLES (Should be PRIMARY source)
-- ========================================
SELECT 'tiktok_posts_daily' as table_name, COUNT(*) as row_count FROM tiktok_posts_daily
UNION ALL
SELECT 'instagram_posts_daily' as table_name, COUNT(*) as row_count FROM instagram_posts_daily
UNION ALL

-- ========================================
-- 2. CHECK IF THERE ARE OTHER POSTS TABLES (Legacy/Unused)
-- ========================================
SELECT 'tiktok_posts' as table_name, COUNT(*) as row_count FROM tiktok_posts
UNION ALL
SELECT 'instagram_posts' as table_name, COUNT(*) as row_count FROM instagram_posts
UNION ALL

-- ========================================  
-- 3. CHECK NORMALIZED/DERIVED TABLES (May have duplicates)
-- ========================================
SELECT 'instagram_posts_daily_norm' as table_name, COUNT(*) as row_count FROM instagram_posts_daily_norm
UNION ALL
SELECT 'group_leaderboard' as table_name, COUNT(*) as row_count FROM group_leaderboard
UNION ALL
SELECT 'groups_total_metrics' as table_name, COUNT(*) as row_count FROM groups_total_metrics
ORDER BY row_count DESC;

-- ========================================
-- 4. CHECK SAMPLE DATA FROM TIKTOK_POSTS_DAILY
-- ========================================
SELECT 
  'tiktok_posts_daily' as source,
  video_id,
  username,
  taken_at,
  post_date,
  play_count,
  created_at
FROM tiktok_posts_daily
ORDER BY created_at DESC
LIMIT 5;

-- ========================================
-- 5. CHECK SAMPLE DATA FROM INSTAGRAM_POSTS_DAILY
-- ========================================
SELECT 
  'instagram_posts_daily' as source,
  id,
  username,
  taken_at,
  post_date,
  play_count,
  created_at
FROM instagram_posts_daily
ORDER BY created_at DESC
LIMIT 5;

-- ========================================
-- 6. CHECK IF POSTS_DAILY HAS RECENT DATA
-- ========================================
SELECT 
  'Recent TikTok Posts (last 7 days)' as info,
  COUNT(*) as count,
  MIN(taken_at) as earliest,
  MAX(taken_at) as latest
FROM tiktok_posts_daily
WHERE taken_at >= CURRENT_DATE - INTERVAL '7 days';

SELECT 
  'Recent Instagram Posts (last 7 days)' as info,
  COUNT(*) as count,
  MIN(taken_at) as earliest,
  MAX(taken_at) as latest
FROM instagram_posts_daily
WHERE taken_at >= CURRENT_DATE - INTERVAL '7 days';

-- ========================================
-- 7. LIST ALL TABLES THAT MIGHT STORE POSTS DATA
-- ========================================
SELECT 
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name)::regclass)) as size
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%post%'
ORDER BY pg_total_relation_size(quote_ident(table_name)::regclass) DESC;

-- ========================================
-- 8. CHECK WHICH COLUMNS EXIST
-- ========================================
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tiktok_posts_daily', 'instagram_posts_daily', 'tiktok_posts', 'instagram_posts')
  AND column_name IN ('post_date', 'taken_at', 'created_at')
ORDER BY table_name, column_name;

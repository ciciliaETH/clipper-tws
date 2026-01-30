-- VERIFY: Check Posts Data in Database
-- Run this to see what data exists and when

-- ========================================
-- Check TikTok Posts Daily Data
-- ========================================
SELECT 
  'TikTok Posts Daily' as source,
  COUNT(*) as total_rows,
  COUNT(DISTINCT username) as unique_users,
  COUNT(DISTINCT video_id) as unique_videos,
  MIN(taken_at) as earliest_post,
  MAX(taken_at) as latest_post,
  MIN(post_date) as earliest_post_date,
  MAX(post_date) as latest_post_date,
  COUNT(CASE WHEN taken_at IS NULL THEN 1 END) as null_taken_at,
  COUNT(CASE WHEN post_date IS NULL THEN 1 END) as null_post_date
FROM tiktok_posts_daily;

-- ========================================
-- Check Instagram Posts Daily Data
-- ========================================
SELECT 
  'Instagram Posts Daily' as source,
  COUNT(*) as total_rows,
  COUNT(DISTINCT username) as unique_users,
  COUNT(DISTINCT id) as unique_posts,
  MIN(taken_at) as earliest_post,
  MAX(taken_at) as latest_post,
  MIN(post_date) as earliest_post_date,
  MAX(post_date) as latest_post_date,
  COUNT(CASE WHEN taken_at IS NULL THEN 1 END) as null_taken_at,
  COUNT(CASE WHEN post_date IS NULL THEN 1 END) as null_post_date
FROM instagram_posts_daily;

-- ========================================
-- Check Posts Count by Date (Last 30 Days)
-- ========================================
SELECT 
  DATE(taken_at) as post_date,
  COUNT(*) as tiktok_posts,
  COUNT(DISTINCT username) as tiktok_users,
  COUNT(DISTINCT video_id) as unique_videos
FROM tiktok_posts_daily
WHERE taken_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(taken_at)
ORDER BY DATE(taken_at) DESC;

SELECT 
  DATE(taken_at) as post_date,
  COUNT(*) as instagram_posts,
  COUNT(DISTINCT username) as instagram_users,
  COUNT(DISTINCT id) as unique_posts
FROM instagram_posts_daily
WHERE taken_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(taken_at)
ORDER BY DATE(taken_at) DESC;

-- ========================================
-- Check Specific Date (26 Jan 2026)
-- ========================================
SELECT 
  'TikTok on 2026-01-26' as info,
  COUNT(*) as total_posts,
  COUNT(DISTINCT username) as unique_users,
  COUNT(DISTINCT video_id) as unique_videos,
  SUM(play_count) as total_views
FROM tiktok_posts_daily
WHERE taken_at >= '2026-01-26T00:00:00Z'
  AND taken_at < '2026-01-27T00:00:00Z';

SELECT 
  'Instagram on 2026-01-26' as info,
  COUNT(*) as total_posts,
  COUNT(DISTINCT username) as unique_users,
  COUNT(DISTINCT id) as unique_posts,
  SUM(play_count) as total_views
FROM instagram_posts_daily
WHERE taken_at >= '2026-01-26T00:00:00Z'
  AND taken_at < '2026-01-27T00:00:00Z';

-- ========================================
-- EXPLANATION OF RESULTS
-- ========================================
-- If you see:
-- - total_rows > 0: Database has data (CHART WILL SHOW DATA) ✅
-- - total_rows = 0: Database empty (CHART WILL BE EMPTY) ✅
-- 
-- Chart showing "Posts: 415" means:
-- - Database has 415 posts on that date
-- - This is CORRECT behavior
-- - Queries are using taken_at from post_daily tables
--
-- To test "empty database = empty chart":
-- 1. Clear data: DELETE FROM tiktok_posts_daily; DELETE FROM instagram_posts_daily;
-- 2. OR query a date range with no data
-- 3. Chart should show 0 posts

-- ========================================
-- OPTIONAL: Clear All Data for Testing
-- ========================================
-- ⚠️ WARNING: This will delete ALL posts data!
-- Uncomment to clear database for testing:

-- BEGIN;
-- DELETE FROM tiktok_posts_daily;
-- DELETE FROM instagram_posts_daily;
-- COMMIT;

-- After clearing, all endpoints should return 0 metrics

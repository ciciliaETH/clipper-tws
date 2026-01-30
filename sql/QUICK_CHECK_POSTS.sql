-- ============================================================
-- QUICK ROW COUNT CHECK
-- ============================================================
-- Run this to quickly check how many posts are saved

SELECT 
  'tiktok_posts_daily' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT username) as unique_usernames,
  MIN(taken_at) as oldest_post,
  MAX(taken_at) as newest_post,
  MAX(created_at) as last_updated
FROM tiktok_posts_daily

UNION ALL

SELECT 
  'instagram_posts_daily',
  COUNT(*),
  COUNT(DISTINCT username),
  MIN(taken_at),
  MAX(taken_at),
  MAX(created_at)
FROM instagram_posts_daily;

-- ============================================================
-- CHECK RECENT SAVES (LAST 1 HOUR)
-- ============================================================
SELECT 
  'TikTok - Last 1 Hour' as info,
  COUNT(*) as rows_saved
FROM tiktok_posts_daily
WHERE created_at >= NOW() - INTERVAL '1 hour';

SELECT 
  'Instagram - Last 1 Hour' as info,
  COUNT(*) as rows_saved
FROM instagram_posts_daily
WHERE created_at >= NOW() - INTERVAL '1 hour';

-- ============================================================
-- TOP 10 USERNAMES BY POST COUNT
-- ============================================================
SELECT 
  'TikTok Top 10' as platform,
  username,
  COUNT(*) as post_count
FROM tiktok_posts_daily
GROUP BY username
ORDER BY post_count DESC
LIMIT 10;

SELECT 
  'Instagram Top 10' as platform,
  username,
  COUNT(*) as post_count
FROM instagram_posts_daily
GROUP BY username
ORDER BY post_count DESC
LIMIT 10;

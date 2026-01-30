-- Test TikTok Post Metrics History Setup
-- Run this AFTER executing 2026-01-28_tiktok_post_metrics_history.sql

-- ============================================================================
-- 1. Check table exists and structure
-- ============================================================================
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'tiktok_post_metrics_history'
ORDER BY ordinal_position;

-- ============================================================================
-- 2. Check trigger is active
-- ============================================================================
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled,
  pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger
WHERE tgname = 'trg_log_tt_post_snapshot';

-- ============================================================================
-- 3. Test trigger by updating a post (DRY RUN - check first)
-- ============================================================================
-- Get a sample post to test
SELECT video_id, username, play_count 
FROM tiktok_posts_daily 
LIMIT 1;

-- Count history records BEFORE update
SELECT COUNT(*) as history_count_before 
FROM tiktok_post_metrics_history;

-- ============================================================================
-- 4. Manual trigger test (OPTIONAL - uncomment to run)
-- ============================================================================
/*
-- Update a post to trigger history insert
UPDATE tiktok_posts_daily 
SET play_count = play_count + 1 
WHERE video_id = 'PASTE_VIDEO_ID_HERE';

-- Check history increased
SELECT COUNT(*) as history_count_after 
FROM tiktok_post_metrics_history;

-- Check latest history entry
SELECT * 
FROM tiktok_post_metrics_history 
ORDER BY captured_at DESC 
LIMIT 5;
*/

-- ============================================================================
-- 5. Compare with Instagram structure (should be similar)
-- ============================================================================
SELECT 
  'TikTok' as platform,
  COUNT(*) as history_count,
  MIN(captured_at) as earliest_snapshot,
  MAX(captured_at) as latest_snapshot
FROM tiktok_post_metrics_history
UNION ALL
SELECT 
  'Instagram',
  COUNT(*),
  MIN(captured_at),
  MAX(captured_at)
FROM instagram_post_metrics_history;

-- ============================================================================
-- 6. Check per-post snapshots (for accrual calculation)
-- ============================================================================
-- Sample: Get history for a specific post
SELECT 
  post_id,
  username,
  captured_at,
  play_count,
  digg_count,
  comment_count
FROM tiktok_post_metrics_history
WHERE post_id = (
  SELECT video_id FROM tiktok_posts_daily LIMIT 1
)
ORDER BY captured_at DESC
LIMIT 10;

-- Backfill TikTok Post Metrics History
-- Run this AFTER creating tiktok_post_metrics_history table
-- Purpose: Populate history from existing tiktok_posts_daily data

BEGIN;

-- Insert current snapshot of all existing posts
INSERT INTO public.tiktok_post_metrics_history (
  post_id,
  username,
  captured_at,
  play_count,
  digg_count,
  comment_count,
  share_count,
  save_count,
  taken_at,
  post_date
)
SELECT 
  video_id,
  username,
  NOW() as captured_at,
  play_count,
  digg_count,
  comment_count,
  share_count,
  save_count,
  taken_at,
  post_date
FROM public.tiktok_posts_daily
ON CONFLICT DO NOTHING;

-- Get count of backfilled records
SELECT COUNT(*) as backfilled_records
FROM public.tiktok_post_metrics_history;

COMMIT;

-- Verify backfill by comparing counts
SELECT 
  'tiktok_posts_daily' as source,
  COUNT(*) as record_count
FROM tiktok_posts_daily
UNION ALL
SELECT 
  'tiktok_post_metrics_history',
  COUNT(DISTINCT post_id)
FROM tiktok_post_metrics_history;

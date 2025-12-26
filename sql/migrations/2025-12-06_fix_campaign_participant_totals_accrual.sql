-- Fix campaign_participant_totals_v2 to use ACCRUAL (delta) not SUM
-- Date: 2025-12-06
-- Issue: Function was summing all snapshots instead of calculating last - first per video
-- Result: Inflated metrics (if 5 snapshots, counts 5x the actual views)

BEGIN;

DROP FUNCTION IF EXISTS public.campaign_participant_totals_v2(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.campaign_participant_totals_v2(
  campaign UUID,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH usernames AS (
  SELECT LOWER(tiktok_username) AS username
  FROM public.campaign_participants
  WHERE campaign_id = campaign
),
-- Group snapshots by video_id to calculate accrual (delta)
video_snapshots AS (
  SELECT 
    p.video_id,
    p.username,
    p.play_count::bigint AS views,
    p.digg_count::bigint AS likes,
    p.comment_count::bigint AS comments,
    p.share_count::bigint AS shares,
    p.save_count::bigint AS saves,
    ROW_NUMBER() OVER (PARTITION BY p.video_id ORDER BY p.post_date ASC) AS rn_first,
    ROW_NUMBER() OVER (PARTITION BY p.video_id ORDER BY p.post_date DESC) AS rn_last,
    COUNT(*) OVER (PARTITION BY p.video_id) AS snapshot_count
  FROM public.tiktok_posts_daily p
  JOIN usernames u ON u.username = p.username
  WHERE p.post_date BETWEEN start_date AND end_date
),
-- Get first and last snapshot per video
video_ranges AS (
  SELECT 
    video_id,
    username,
    MAX(CASE WHEN rn_first = 1 THEN views ELSE 0 END) AS first_views,
    MAX(CASE WHEN rn_first = 1 THEN likes ELSE 0 END) AS first_likes,
    MAX(CASE WHEN rn_first = 1 THEN comments ELSE 0 END) AS first_comments,
    MAX(CASE WHEN rn_first = 1 THEN shares ELSE 0 END) AS first_shares,
    MAX(CASE WHEN rn_first = 1 THEN saves ELSE 0 END) AS first_saves,
    MAX(CASE WHEN rn_last = 1 THEN views ELSE 0 END) AS last_views,
    MAX(CASE WHEN rn_last = 1 THEN likes ELSE 0 END) AS last_likes,
    MAX(CASE WHEN rn_last = 1 THEN comments ELSE 0 END) AS last_comments,
    MAX(CASE WHEN rn_last = 1 THEN shares ELSE 0 END) AS last_shares,
    MAX(CASE WHEN rn_last = 1 THEN saves ELSE 0 END) AS last_saves,
    MAX(snapshot_count) AS snapshot_count
  FROM video_snapshots
  GROUP BY video_id, username
),
-- Calculate accrual per video (last - first, or just value if single snapshot)
video_accrual AS (
  SELECT 
    username,
    CASE 
      WHEN snapshot_count = 1 THEN last_views
      ELSE GREATEST(last_views - first_views, 0)
    END AS accrual_views,
    CASE 
      WHEN snapshot_count = 1 THEN last_likes
      ELSE GREATEST(last_likes - first_likes, 0)
    END AS accrual_likes,
    CASE 
      WHEN snapshot_count = 1 THEN last_comments
      ELSE GREATEST(last_comments - first_comments, 0)
    END AS accrual_comments,
    CASE 
      WHEN snapshot_count = 1 THEN last_shares
      ELSE GREATEST(last_shares - first_shares, 0)
    END AS accrual_shares,
    CASE 
      WHEN snapshot_count = 1 THEN last_saves
      ELSE GREATEST(last_saves - first_saves, 0)
    END AS accrual_saves
  FROM video_ranges
)
SELECT
  username,
  SUM(accrual_views)::bigint AS views,
  SUM(accrual_likes)::bigint AS likes,
  SUM(accrual_comments)::bigint AS comments,
  SUM(accrual_shares)::bigint AS shares,
  SUM(accrual_saves)::bigint AS saves
FROM video_accrual
GROUP BY username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_participant_totals_v2(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.campaign_participant_totals_v2 IS 'Returns campaign participant totals using ACCRUAL method (last snapshot - first snapshot per video), not sum of all snapshots. This prevents inflated metrics when videos are tracked multiple times.';

COMMIT;

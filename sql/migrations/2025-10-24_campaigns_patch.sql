-- Patch campaigns functions and constraints
-- Date: 2025-10-24

BEGIN;

-- Ensure uniqueness of participants within the same campaign
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_campaign_participants_campaign_username'
  ) THEN
    CREATE UNIQUE INDEX uq_campaign_participants_campaign_username
      ON public.campaign_participants(campaign_id, tiktok_username);
  END IF;
END $$;

-- Drop old functions if they exist
DROP FUNCTION IF EXISTS public.campaign_series(UUID, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.campaign_participant_totals(UUID, DATE, DATE);

-- Recreate with new names to avoid schema cache issues
CREATE OR REPLACE FUNCTION public.campaign_series_v2(
  campaign UUID,
  start_date DATE,
  end_date DATE,
  p_interval TEXT DEFAULT 'daily'
)
RETURNS TABLE(
  bucket_date DATE,
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
    p.post_date::date AS d,
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
-- Calculate accrual per video (last snapshot - first snapshot)
video_accrual AS (
  SELECT 
    video_id,
    d,
    CASE 
      WHEN snapshot_count = 1 THEN views
      WHEN rn_last = 1 THEN views - COALESCE((SELECT views FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_views,
    CASE 
      WHEN snapshot_count = 1 THEN likes
      WHEN rn_last = 1 THEN likes - COALESCE((SELECT likes FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_likes,
    CASE 
      WHEN snapshot_count = 1 THEN comments
      WHEN rn_last = 1 THEN comments - COALESCE((SELECT comments FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_comments,
    CASE 
      WHEN snapshot_count = 1 THEN shares
      WHEN rn_last = 1 THEN shares - COALESCE((SELECT shares FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_shares,
    CASE 
      WHEN snapshot_count = 1 THEN saves
      WHEN rn_last = 1 THEN saves - COALESCE((SELECT saves FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_saves
  FROM video_snapshots
  WHERE rn_last = 1  -- Only take the last snapshot per video to get the date
)
SELECT
  CASE
    WHEN p_interval = 'weekly' THEN date_trunc('week', d)::date
    WHEN p_interval = 'monthly' THEN date_trunc('month', d)::date
    ELSE d
  END AS bucket_date,
  SUM(GREATEST(accrual_views, 0)) AS views,
  SUM(GREATEST(accrual_likes, 0)) AS likes,
  SUM(GREATEST(accrual_comments, 0)) AS comments,
  SUM(GREATEST(accrual_shares, 0)) AS shares,
  SUM(GREATEST(accrual_saves, 0)) AS saves
FROM video_accrual
GROUP BY 1
ORDER BY 1;
$$;

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
SELECT p.username,
       SUM(p.play_count)::bigint AS views,
       SUM(p.digg_count)::bigint AS likes,
       SUM(p.comment_count)::bigint AS comments,
       SUM(p.share_count)::bigint AS shares,
       SUM(p.save_count)::bigint AS saves
FROM public.tiktok_posts_daily p
JOIN public.campaign_participants cp ON LOWER(cp.tiktok_username) = p.username
WHERE cp.campaign_id = campaign
  AND p.post_date BETWEEN start_date AND end_date
GROUP BY p.username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_series_v2(UUID, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_participant_totals_v2(UUID, DATE, DATE) TO authenticated;

COMMIT;

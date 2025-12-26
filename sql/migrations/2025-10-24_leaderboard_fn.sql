-- Leaderboard function for TikTok metrics
-- Date: 2025-10-24

BEGIN;

-- Drop existing function first because return type changed
DROP FUNCTION IF EXISTS public.leaderboard_tiktok(TEXT, DATE, DATE, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.leaderboard_tiktok(
  metric TEXT,
  start_date DATE,
  end_date DATE,
  top_n INTEGER DEFAULT 15,
  campaign UUID DEFAULT NULL
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH base AS (
  SELECT LOWER(tp.username) AS username,
         COALESCE(SUM(tp.play_count),0)::bigint AS views,
         COALESCE(SUM(tp.digg_count),0)::bigint AS likes,
         COALESCE(SUM(tp.comment_count),0)::bigint AS comments,
         COALESCE(SUM(tp.share_count),0)::bigint AS shares,
         COALESCE(SUM(tp.save_count),0)::bigint AS saves,
         (COALESCE(SUM(tp.play_count),0)
        + COALESCE(SUM(tp.digg_count),0)
        + COALESCE(SUM(tp.comment_count),0)
        + COALESCE(SUM(tp.share_count),0)
        + COALESCE(SUM(tp.save_count),0))::bigint AS total
  FROM public.tiktok_posts_daily tp
  JOIN public.users u
    ON LOWER(u.tiktok_username) = LOWER(tp.username)
   AND u.role = 'umum'
  WHERE tp.post_date BETWEEN start_date AND end_date
  GROUP BY 1
), filtered AS (
  SELECT b.*
  FROM base b
  WHERE campaign IS NULL
     OR EXISTS (
       SELECT 1 FROM public.campaign_participants cp
       WHERE cp.campaign_id = campaign
         AND LOWER(cp.tiktok_username) = b.username
     )
)
SELECT *
FROM filtered
ORDER BY CASE
           WHEN metric = 'likes' THEN likes
           WHEN metric = 'comments' THEN comments
           WHEN metric = 'shares' THEN shares
           WHEN metric = 'saves' THEN saves
           WHEN metric = 'views' THEN views
           ELSE total -- default or 'total'
         END DESC NULLS LAST
LIMIT top_n;
$$;

GRANT EXECUTE ON FUNCTION public.leaderboard_tiktok(TEXT, DATE, DATE, INTEGER, UUID) TO authenticated;

COMMIT;

-- Employee Profile Enhancements
-- Add profile picture support and create view for total metrics across all platforms
-- Date: 2025-12-04

BEGIN;

-- 1. Add profile_picture_url to users table
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- 2. Create materialized view for employee total metrics (TikTok + Instagram combined)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.employee_total_metrics AS
WITH tiktok_totals AS (
  -- Aggregate TikTok metrics from tiktok_posts_daily
  SELECT 
    etp.employee_id as user_id,
    SUM(COALESCE(tpd.play_count, 0)) as tiktok_views,
    SUM(COALESCE(tpd.digg_count, 0)) as tiktok_likes,
    SUM(COALESCE(tpd.comment_count, 0)) as tiktok_comments,
    SUM(COALESCE(tpd.share_count, 0)) as tiktok_shares,
    0 as tiktok_followers,
    MAX(tpd.created_at) as tiktok_last_updated
  FROM public.employee_participants etp
  JOIN public.tiktok_posts_daily tpd 
    ON LOWER(etp.tiktok_username) = LOWER(tpd.username)
  GROUP BY etp.employee_id
),
instagram_totals AS (
  -- Aggregate Instagram metrics from instagram_posts_daily
  SELECT
    eip.employee_id as user_id,
    SUM(COALESCE(ipd.play_count, 0)) as instagram_views,
    SUM(COALESCE(ipd.like_count, 0)) as instagram_likes,
    SUM(COALESCE(ipd.comment_count, 0)) as instagram_comments,
    0 as instagram_shares,
    0 as instagram_followers,
    MAX(ipd.created_at) as instagram_last_updated
  FROM public.employee_instagram_participants eip
  JOIN public.instagram_posts_daily ipd 
    ON LOWER(eip.instagram_username) = LOWER(ipd.username)
  GROUP BY eip.employee_id
),
employee_usernames AS (
  -- Get employee TikTok usernames (from multiple sources)
  SELECT DISTINCT
    u.id as user_id,
    COALESCE(
      utu.tiktok_username,
      u.tiktok_username
    ) as tiktok_username
  FROM public.users u
  LEFT JOIN public.user_tiktok_usernames utu ON u.id = utu.user_id
  WHERE u.role = 'karyawan'
),
employee_ig_usernames AS (
  -- Get employee Instagram usernames
  SELECT DISTINCT
    u.id as user_id,
    COALESCE(
      uiu.instagram_username,
      u.instagram_username
    ) as instagram_username
  FROM public.users u
  LEFT JOIN public.user_instagram_usernames uiu ON u.id = uiu.user_id
  WHERE u.role = 'karyawan'
)
SELECT
  u.id as employee_id,
  u.full_name,
  u.username,
  u.email,
  u.profile_picture_url,
  -- TikTok totals
  COALESCE(tt.tiktok_views, 0) as total_tiktok_views,
  COALESCE(tt.tiktok_likes, 0) as total_tiktok_likes,
  COALESCE(tt.tiktok_comments, 0) as total_tiktok_comments,
  COALESCE(tt.tiktok_shares, 0) as total_tiktok_shares,
  COALESCE(tt.tiktok_followers, 0) as total_tiktok_followers,
  -- Instagram totals
  COALESCE(it.instagram_views, 0) as total_instagram_views,
  COALESCE(it.instagram_likes, 0) as total_instagram_likes,
  COALESCE(it.instagram_comments, 0) as total_instagram_comments,
  COALESCE(it.instagram_shares, 0) as total_instagram_shares,
  COALESCE(it.instagram_followers, 0) as total_instagram_followers,
  -- Combined totals
  COALESCE(tt.tiktok_views, 0) + COALESCE(it.instagram_views, 0) as total_views,
  COALESCE(tt.tiktok_likes, 0) + COALESCE(it.instagram_likes, 0) as total_likes,
  COALESCE(tt.tiktok_comments, 0) + COALESCE(it.instagram_comments, 0) as total_comments,
  COALESCE(tt.tiktok_shares, 0) + COALESCE(it.instagram_shares, 0) as total_shares,
  -- Usernames
  (SELECT array_agg(DISTINCT tiktok_username) FROM employee_usernames eu WHERE eu.user_id = u.id) as tiktok_usernames,
  (SELECT array_agg(DISTINCT instagram_username) FROM employee_ig_usernames eiu WHERE eiu.user_id = u.id) as instagram_usernames,
  -- Last updated timestamps
  tt.tiktok_last_updated,
  it.instagram_last_updated,
  GREATEST(tt.tiktok_last_updated, it.instagram_last_updated) as last_updated
FROM public.users u
LEFT JOIN tiktok_totals tt ON u.id = tt.user_id
LEFT JOIN instagram_totals it ON u.id = it.user_id
WHERE u.role = 'karyawan';

-- Create index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_total_metrics_employee_id 
  ON public.employee_total_metrics(employee_id);

-- 3. Create function to refresh the materialized view
CREATE OR REPLACE FUNCTION public.refresh_employee_total_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.employee_total_metrics;
END;
$$;

-- 4. Grant permissions
GRANT SELECT ON public.employee_total_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_employee_total_metrics() TO authenticated;

-- 5. Initial refresh
REFRESH MATERIALIZED VIEW public.employee_total_metrics;

COMMIT;

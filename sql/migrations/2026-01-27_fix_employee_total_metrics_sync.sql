-- Fix employee_total_metrics to use user_tiktok_usernames and user_instagram_usernames
-- This ensures metrics stay in sync when usernames are updated/deleted
-- Date: 2026-01-27

BEGIN;

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS public.employee_total_metrics CASCADE;

-- Recreate with proper username source from mapping tables
CREATE MATERIALIZED VIEW public.employee_total_metrics AS
WITH tiktok_totals AS (
  -- Aggregate TikTok metrics using user_tiktok_usernames (source of truth)
  SELECT 
    utu.user_id,
    SUM(COALESCE(tpd.play_count, 0)) as tiktok_views,
    SUM(COALESCE(tpd.digg_count, 0)) as tiktok_likes,
    SUM(COALESCE(tpd.comment_count, 0)) as tiktok_comments,
    SUM(COALESCE(tpd.share_count, 0)) as tiktok_shares,
    0 as tiktok_followers,
    MAX(tpd.created_at) as tiktok_last_updated
  FROM public.user_tiktok_usernames utu
  JOIN public.tiktok_posts_daily tpd 
    ON LOWER(utu.tiktok_username) = LOWER(tpd.username)
  GROUP BY utu.user_id
),
instagram_totals AS (
  -- Aggregate Instagram metrics using user_instagram_usernames (source of truth)
  SELECT
    uiu.user_id,
    SUM(COALESCE(ipd.play_count, 0)) as instagram_views,
    SUM(COALESCE(ipd.like_count, 0)) as instagram_likes,
    SUM(COALESCE(ipd.comment_count, 0)) as instagram_comments,
    0 as instagram_shares,
    0 as instagram_followers,
    MAX(ipd.created_at) as instagram_last_updated
  FROM public.user_instagram_usernames uiu
  JOIN public.instagram_posts_daily ipd 
    ON LOWER(uiu.instagram_username) = LOWER(ipd.username)
  GROUP BY uiu.user_id
),
all_usernames AS (
  -- Get all TikTok usernames per user
  SELECT 
    user_id,
    ARRAY_AGG(DISTINCT tiktok_username) as tiktok_usernames
  FROM public.user_tiktok_usernames
  GROUP BY user_id
),
all_ig_usernames AS (
  -- Get all Instagram usernames per user
  SELECT 
    user_id,
    ARRAY_AGG(DISTINCT instagram_username) as instagram_usernames
  FROM public.user_instagram_usernames
  GROUP BY user_id
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
  -- Usernames from mapping tables (arrays for multiple usernames)
  COALESCE(au.tiktok_usernames, ARRAY[]::TEXT[]) as tiktok_usernames,
  COALESCE(aiu.instagram_usernames, ARRAY[]::TEXT[]) as instagram_usernames,
  -- Last updated timestamps
  tt.tiktok_last_updated,
  it.instagram_last_updated,
  GREATEST(
    COALESCE(tt.tiktok_last_updated, '1970-01-01'::TIMESTAMP),
    COALESCE(it.instagram_last_updated, '1970-01-01'::TIMESTAMP)
  ) as last_updated
FROM public.users u
LEFT JOIN tiktok_totals tt ON u.id = tt.user_id
LEFT JOIN instagram_totals it ON u.id = it.user_id
LEFT JOIN all_usernames au ON u.id = au.user_id
LEFT JOIN all_ig_usernames aiu ON u.id = aiu.user_id
WHERE u.role = 'karyawan';

-- Create index for fast lookups
CREATE UNIQUE INDEX idx_employee_total_metrics_employee_id 
  ON public.employee_total_metrics(employee_id);

-- Grant permissions
GRANT SELECT ON public.employee_total_metrics TO authenticated;

-- Initial refresh
REFRESH MATERIALIZED VIEW public.employee_total_metrics;

COMMIT;

-- Verification query
DO $$
DECLARE
  total_employees INT;
  employees_with_tiktok INT;
  employees_with_instagram INT;
BEGIN
  SELECT COUNT(*) INTO total_employees FROM public.employee_total_metrics;
  SELECT COUNT(*) INTO employees_with_tiktok FROM public.employee_total_metrics WHERE array_length(tiktok_usernames, 1) > 0;
  SELECT COUNT(*) INTO employees_with_instagram FROM public.employee_total_metrics WHERE array_length(instagram_usernames, 1) > 0;
  
  RAISE NOTICE '✓ employee_total_metrics recreated successfully';
  RAISE NOTICE '  - Total employees: %', total_employees;
  RAISE NOTICE '  - Employees with TikTok usernames: %', employees_with_tiktok;
  RAISE NOTICE '  - Employees with Instagram usernames: %', employees_with_instagram;
END $$;

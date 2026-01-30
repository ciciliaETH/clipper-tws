-- Test Script: Check if snapshot population will work
-- Run this BEFORE calling populate functions

-- ============================================================================
-- 1. Check if we have active campaigns
-- ============================================================================
SELECT 
  id,
  title,
  start_date,
  end_date,
  CASE 
    WHEN start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE)
    THEN 'ACTIVE ✅'
    ELSE 'INACTIVE ❌'
  END as status
FROM public.campaigns
ORDER BY start_date DESC
LIMIT 10;

-- ============================================================================
-- 2. Check TikTok participants
-- ============================================================================
SELECT 
  cp.campaign_id,
  c.title as campaign_name,
  cp.tiktok_username,
  COUNT(*) OVER (PARTITION BY cp.campaign_id) as total_participants
FROM public.campaign_participants cp
INNER JOIN public.campaigns c ON c.id = cp.campaign_id
WHERE c.start_date <= CURRENT_DATE 
  AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
LIMIT 20;

-- ============================================================================
-- 3. Check Instagram participants
-- ============================================================================
SELECT 
  cip.campaign_id,
  c.title as campaign_name,
  cip.instagram_username,
  COUNT(*) OVER (PARTITION BY cip.campaign_id) as total_participants
FROM public.campaign_instagram_participants cip
INNER JOIN public.campaigns c ON c.id = cip.campaign_id
WHERE c.start_date <= CURRENT_DATE 
  AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
LIMIT 20;

-- ============================================================================
-- 4. Check if TikTok posts_daily has data for participants
-- ============================================================================
SELECT 
  cp.tiktok_username,
  COUNT(td.video_id) as total_posts,
  MIN(td.taken_at) as earliest_post,
  MAX(td.taken_at) as latest_post
FROM public.campaign_participants cp
INNER JOIN public.campaigns c ON c.id = cp.campaign_id
LEFT JOIN public.tiktok_posts_daily td ON LOWER(td.username) = LOWER(cp.tiktok_username)
WHERE c.start_date <= CURRENT_DATE 
  AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
GROUP BY cp.tiktok_username
LIMIT 20;

-- ============================================================================
-- 5. Check if Instagram posts_daily has data for participants
-- ============================================================================
SELECT 
  cip.instagram_username,
  COUNT(id.id) as total_posts,
  MIN(id.taken_at) as earliest_post,
  MAX(id.taken_at) as latest_post
FROM public.campaign_instagram_participants cip
INNER JOIN public.campaigns c ON c.id = cip.campaign_id
LEFT JOIN public.instagram_posts_daily id ON LOWER(id.username) = LOWER(cip.instagram_username)
WHERE c.start_date <= CURRENT_DATE 
  AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
GROUP BY cip.instagram_username
LIMIT 20;

-- ============================================================================
-- 6. Manual test populate (DRY RUN - Preview what will be inserted)
-- ============================================================================
-- TikTok Preview
SELECT 
  cp.campaign_id,
  c.title as campaign_name,
  cp.tiktok_username,
  td.video_id as aweme_id,
  td.play_count,
  td.taken_at,
  'Will be inserted' as action
FROM public.campaign_participants cp
INNER JOIN public.campaigns c ON c.id = cp.campaign_id
INNER JOIN public.tiktok_posts_daily td ON LOWER(td.username) = LOWER(cp.tiktok_username)
WHERE 
  c.start_date <= CURRENT_DATE
  AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
  AND td.taken_at >= (c.start_date || ' 00:00:00')::TIMESTAMPTZ
  AND (c.end_date IS NULL OR td.taken_at <= (c.end_date || ' 23:59:59')::TIMESTAMPTZ)
LIMIT 10;

-- Instagram Preview
SELECT 
  cip.campaign_id,
  c.title as campaign_name,
  cip.instagram_username,
  id.id as post_id,
  id.play_count,
  id.taken_at,
  'Will be inserted' as action
FROM public.campaign_instagram_participants cip
INNER JOIN public.campaigns c ON c.id = cip.campaign_id
INNER JOIN public.instagram_posts_daily id ON LOWER(id.username) = LOWER(cip.instagram_username)
WHERE 
  c.start_date <= CURRENT_DATE
  AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
  AND id.taken_at >= (c.start_date || ' 00:00:00')::TIMESTAMPTZ
  AND (c.end_date IS NULL OR id.taken_at <= (c.end_date || ' 23:59:59')::TIMESTAMPTZ)
LIMIT 10;

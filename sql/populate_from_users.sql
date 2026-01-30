-- Fix: Populate employee participants using users table directly
-- employee_id in participants tables = user_id from users table
-- More clear and direct approach

BEGIN;

-- Clear existing data first (optional, remove if you want to keep)
-- TRUNCATE public.employee_tiktok_participants;
-- TRUNCATE public.employee_instagram_participants;

-- Populate TikTok participants
-- Logic: Get all users with TikTok usernames, assign to all campaigns
INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
SELECT DISTINCT
  u.id as employee_id,  -- user.id = employee_id (same thing)
  c.id as campaign_id,
  utu.tiktok_username,
  NOW()
FROM public.users u
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = u.id
CROSS JOIN public.campaigns c
ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;

-- Populate Instagram participants  
-- Logic: Get all users with Instagram usernames, assign to all campaigns
INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
SELECT DISTINCT
  u.id as employee_id,  -- user.id = employee_id (same thing)
  c.id as campaign_id,
  uiu.instagram_username,
  NOW()
FROM public.users u
INNER JOIN public.user_instagram_usernames uiu ON uiu.user_id = u.id
CROSS JOIN public.campaigns c
ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;

COMMIT;

-- Verification with proper naming
SELECT 
  'users_with_tiktok' as description,
  COUNT(DISTINCT u.id) as user_count
FROM public.users u
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = u.id
UNION ALL
SELECT 
  'users_with_instagram' as description,
  COUNT(DISTINCT u.id) as user_count
FROM public.users u
INNER JOIN public.user_instagram_usernames uiu ON uiu.user_id = u.id
UNION ALL
SELECT 
  'employee_tiktok_participants' as description,
  COUNT(*) as row_count
FROM public.employee_tiktok_participants
UNION ALL
SELECT 
  'employee_instagram_participants' as description,
  COUNT(*) as row_count
FROM public.employee_instagram_participants;

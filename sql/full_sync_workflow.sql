-- Full sync workflow - Run these in order:

-- STEP 1: Create employee_tiktok_participants table (if not exists)
-- File: sql/migrations/2026-01-28_employee_tiktok_participants.sql

-- STEP 2: Backfill user_tiktok_usernames from existing data
-- File: sql/backfill_user_tiktok_usernames.sql

-- STEP 3: Sync employee social participants
-- File: sql/sync_employee_social_participants.sql

-- Run this combined script to do all steps at once:

BEGIN;

-- Populate user_tiktok_usernames from users.tiktok_username
INSERT INTO public.user_tiktok_usernames (user_id, tiktok_username, created_at)
SELECT DISTINCT
  u.id as user_id,
  u.tiktok_username,
  NOW()
FROM public.users u
WHERE u.tiktok_username IS NOT NULL 
  AND u.tiktok_username != ''
ON CONFLICT (user_id, tiktok_username) DO NOTHING;

-- Now sync to employee_tiktok_participants
-- Direct approach: user_id from user_tiktok_usernames = employee_id
-- Cross join with all campaigns
INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
SELECT DISTINCT
  utu.user_id as employee_id,
  c.id as campaign_id,
  utu.tiktok_username,
  NOW()
FROM public.user_tiktok_usernames utu
CROSS JOIN public.campaigns c
ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;

-- Also ensure Instagram participants are synced (for any new users)
-- Match structure: user_id from user_instagram_usernames = employee_id
INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
SELECT DISTINCT
  uiu.user_id as employee_id,
  c.id as campaign_id,
  uiu.instagram_username,
  NOW()
FROM public.user_instagram_usernames uiu
CROSS JOIN public.campaigns c
ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;

COMMIT;

-- Final verification
SELECT 
  'user_tiktok_usernames' as table_name,
  COUNT(*) as row_count
FROM public.user_tiktok_usernames
UNION ALL
SELECT 
  'employee_tiktok_participants' as table_name,
  COUNT(*) as row_count
FROM public.employee_tiktok_participants
UNION ALL
SELECT 
  'employee_instagram_participants' as table_name,
  COUNT(*) as row_count
FROM public.employee_instagram_participants;

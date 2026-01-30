-- Sync employee_tiktok_participants and employee_instagram_participants 
-- from user_tiktok_usernames and user_instagram_usernames
-- Run this after creating employee_tiktok_participants table

BEGIN;

-- Option 1: If you have employee_participants table populated, use this:
/*
INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
SELECT DISTINCT
  ep.employee_id,
  ep.campaign_id,
  utu.tiktok_username,
  NOW()
FROM public.employee_participants ep
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = ep.employee_id
ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;

INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
SELECT DISTINCT
  ep.employee_id,
  ep.campaign_id,
  uiu.instagram_username,
  NOW()
FROM public.employee_participants ep
INNER JOIN public.user_instagram_usernames uiu ON uiu.user_id = ep.employee_id
ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;
*/

-- Option 2: If employee_participants table doesn't exist yet, populate from employee_accounts + campaigns
-- This assumes all employees should be in all campaigns (adjust WHERE clause as needed)
INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
SELECT DISTINCT
  ea.employee_id,
  c.id as campaign_id,
  utu.tiktok_username,
  NOW()
FROM public.employee_accounts ea
CROSS JOIN public.campaigns c
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = ea.employee_id
ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;

INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
SELECT DISTINCT
  ea.employee_id,
  c.id as campaign_id,
  uiu.instagram_username,
  NOW()
FROM public.employee_accounts ea
CROSS JOIN public.campaigns c
INNER JOIN public.user_instagram_usernames uiu ON uiu.user_id = ea.employee_id
ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;

COMMIT;

-- Verify results
SELECT 
  'employee_tiktok_participants' as table_name,
  COUNT(*) as row_count
FROM public.employee_tiktok_participants
UNION ALL
SELECT 
  'employee_instagram_participants' as table_name,
  COUNT(*) as row_count
FROM public.employee_instagram_participants;

-- Final verification: Is the data correct?

-- Check 1: How many campaigns exactly?
SELECT 
  'Total campaigns' as description,
  COUNT(*) as count
FROM public.campaigns;

-- Check 2: Distribution per user - TikTok
SELECT 
  u.id as user_id,
  u.full_name,
  COUNT(DISTINCT utu.tiktok_username) as tiktok_usernames_count,
  COUNT(DISTINCT etp.campaign_id) as campaigns_count,
  COUNT(*) as total_participant_rows
FROM public.users u
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = u.id
LEFT JOIN public.employee_tiktok_participants etp ON etp.employee_id = u.id
GROUP BY u.id, u.full_name
ORDER BY tiktok_usernames_count DESC, total_participant_rows DESC
LIMIT 10;

-- Check 3: Distribution per user - Instagram
SELECT 
  u.id as user_id,
  u.full_name,
  COUNT(DISTINCT uiu.instagram_username) as instagram_usernames_count,
  COUNT(DISTINCT eip.campaign_id) as campaigns_count,
  COUNT(*) as total_participant_rows
FROM public.users u
INNER JOIN public.user_instagram_usernames uiu ON uiu.user_id = u.id
LEFT JOIN public.employee_instagram_participants eip ON eip.employee_id = u.id
GROUP BY u.id, u.full_name
ORDER BY instagram_usernames_count DESC, total_participant_rows DESC
LIMIT 10;

-- Check 4: Expected vs Actual
-- If 12 campaigns: 
-- - 19 TikTok users × 12 = 228 (if 1 username each)
-- - We have 236, meaning some users have multiple TikTok accounts
SELECT 
  'Expected TikTok rows (1 username per user)' as description,
  COUNT(DISTINCT u.id) * 12 as expected,
  (SELECT COUNT(*) FROM public.employee_tiktok_participants) as actual,
  (SELECT COUNT(*) FROM public.employee_tiktok_participants) - (COUNT(DISTINCT u.id) * 12) as difference
FROM public.users u
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = u.id;

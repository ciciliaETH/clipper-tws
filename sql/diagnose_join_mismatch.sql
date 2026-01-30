-- Diagnostic: Why employee_tiktok_participants still 0 after backfill?

-- Check 1: Sample user_ids from user_tiktok_usernames
SELECT 'user_tiktok_usernames' as source, user_id, tiktok_username
FROM public.user_tiktok_usernames
LIMIT 5;

-- Check 2: Sample employee_ids from employee_accounts
SELECT 'employee_accounts' as source, employee_id, account_user_id
FROM public.employee_accounts
LIMIT 5;

-- Check 3: Are the UUIDs matching at all?
SELECT 
  'Direct match' as test,
  COUNT(*) as match_count
FROM public.employee_accounts ea
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = ea.employee_id;

-- Check 4: Try with account_user_id instead
SELECT 
  'Using account_user_id' as test,
  COUNT(*) as match_count
FROM public.employee_accounts ea
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = ea.account_user_id;

-- Check 5: What if we compare with user_instagram_usernames (which works)?
SELECT 
  'Instagram match with employee_id' as test,
  COUNT(*) as match_count
FROM public.employee_accounts ea
INNER JOIN public.user_instagram_usernames uiu ON uiu.user_id = ea.employee_id;

-- Check 6: Instagram match with account_user_id?
SELECT 
  'Instagram match with account_user_id' as test,
  COUNT(*) as match_count
FROM public.employee_accounts ea
INNER JOIN public.user_instagram_usernames uiu ON uiu.user_id = ea.account_user_id;

-- Check 7: Preview what the correct JOIN should produce
SELECT 
  ea.employee_id,
  ea.account_user_id,
  utu.user_id as tiktok_user_id,
  utu.tiktok_username
FROM public.employee_accounts ea
LEFT JOIN public.user_tiktok_usernames utu ON utu.user_id = ea.account_user_id
LIMIT 10;

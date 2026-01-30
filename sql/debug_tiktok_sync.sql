-- Debug why employee_tiktok_participants returned 0 rows

-- Check 1: How many rows in user_tiktok_usernames?
SELECT 
  'user_tiktok_usernames' as table_name,
  COUNT(*) as row_count
FROM public.user_tiktok_usernames;

-- Check 2: How many rows in employee_accounts?
SELECT 
  'employee_accounts' as table_name,
  COUNT(*) as row_count
FROM public.employee_accounts;

-- Check 3: How many campaigns?
SELECT 
  'campaigns' as table_name,
  COUNT(*) as row_count
FROM public.campaigns;

-- Check 4: Sample data from user_tiktok_usernames
SELECT user_id, tiktok_username
FROM public.user_tiktok_usernames
LIMIT 5;

-- Check 5: Sample data from employee_accounts
SELECT employee_id, account_user_id
FROM public.employee_accounts
LIMIT 5;

-- Check 6: Try to find matching employee_id between tables
SELECT 
  'Matching employees' as description,
  COUNT(DISTINCT ea.employee_id) as count
FROM public.employee_accounts ea
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = ea.employee_id;

-- Check 7: Full diagnostic - what would the INSERT return?
SELECT 
  ea.employee_id,
  c.id as campaign_id,
  utu.tiktok_username
FROM public.employee_accounts ea
CROSS JOIN public.campaigns c
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = ea.employee_id
LIMIT 10;

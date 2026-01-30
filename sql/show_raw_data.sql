-- Simple diagnostic - show raw data to understand the structure

-- Step 1: Show actual data from user_tiktok_usernames
SELECT 'user_tiktok_usernames' as table_name, user_id, tiktok_username
FROM public.user_tiktok_usernames
ORDER BY created_at DESC
LIMIT 5;

-- Step 2: Show actual data from user_instagram_usernames  
SELECT 'user_instagram_usernames' as table_name, user_id, instagram_username
FROM public.user_instagram_usernames
ORDER BY created_at DESC
LIMIT 5;

-- Step 3: Show actual data from employee_accounts
SELECT 'employee_accounts' as table_name, employee_id, account_user_id
FROM public.employee_accounts
LIMIT 5;

-- Step 4: How did the 59 Instagram rows get created? Let's check the data
SELECT 'employee_instagram_participants' as table_name, 
       employee_id, 
       campaign_id, 
       instagram_username
FROM public.employee_instagram_participants
LIMIT 5;

-- Step 5: Check if employee_instagram_participants.employee_id matches anywhere
SELECT 
  eip.employee_id as from_instagram_participants,
  ea.employee_id as from_employee_accounts,
  ea.account_user_id as account_user_id,
  uiu.user_id as from_user_instagram
FROM public.employee_instagram_participants eip
LEFT JOIN public.employee_accounts ea ON ea.employee_id = eip.employee_id
LEFT JOIN public.user_instagram_usernames uiu ON uiu.instagram_username = eip.instagram_username
LIMIT 5;

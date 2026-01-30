-- Verify the math: why 236 rows?

-- Step 1: How many campaigns?
SELECT 
  'campaigns' as table_name,
  COUNT(*) as count
FROM public.campaigns;

-- Step 2: Math check for TikTok
-- 59 users × X campaigns = 236 rows?
SELECT 
  'TikTok Math' as description,
  COUNT(DISTINCT employee_id) as unique_employees,
  COUNT(DISTINCT campaign_id) as unique_campaigns,
  COUNT(*) as total_rows,
  COUNT(*) / COUNT(DISTINCT employee_id) as rows_per_employee
FROM public.employee_tiktok_participants;

-- Step 3: Math check for Instagram
SELECT 
  'Instagram Math' as description,
  COUNT(DISTINCT employee_id) as unique_employees,
  COUNT(DISTINCT campaign_id) as unique_campaigns,
  COUNT(*) as total_rows,
  COUNT(*) / COUNT(DISTINCT employee_id) as rows_per_employee
FROM public.employee_instagram_participants;

-- Step 4: Sample distribution - how many usernames per employee?
SELECT 
  employee_id,
  COUNT(DISTINCT tiktok_username) as tiktok_count,
  COUNT(DISTINCT campaign_id) as campaign_count,
  COUNT(*) as total_rows
FROM public.employee_tiktok_participants
GROUP BY employee_id
ORDER BY total_rows DESC
LIMIT 5;

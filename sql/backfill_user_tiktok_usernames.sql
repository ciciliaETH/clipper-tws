-- Populate user_tiktok_usernames from existing data sources
-- This will backfill the missing TikTok usernames

BEGIN;

-- Option 1: From users.tiktok_username (if column exists and has data)
INSERT INTO public.user_tiktok_usernames (user_id, tiktok_username, created_at)
SELECT DISTINCT
  u.id as user_id,
  u.tiktok_username,
  NOW()
FROM public.users u
WHERE u.tiktok_username IS NOT NULL 
  AND u.tiktok_username != ''
ON CONFLICT (user_id, tiktok_username) DO NOTHING;

-- Option 2: From employee_participants.tiktok_username (if table exists)
INSERT INTO public.user_tiktok_usernames (user_id, tiktok_username, created_at)
SELECT DISTINCT
  ep.employee_id as user_id,
  ep.tiktok_username,
  NOW()
FROM public.employee_participants ep
WHERE ep.tiktok_username IS NOT NULL 
  AND ep.tiktok_username != ''
ON CONFLICT (user_id, tiktok_username) DO NOTHING;

-- Option 3: From tiktok_posts_daily (extract usernames from posts)
INSERT INTO public.user_tiktok_usernames (user_id, tiktok_username, created_at)
SELECT DISTINCT
  ea.employee_id as user_id,
  tpd.tiktok_username,
  NOW()
FROM public.tiktok_posts_daily tpd
INNER JOIN public.employee_accounts ea ON ea.account_user_id = ea.employee_id
WHERE tpd.tiktok_username IS NOT NULL 
  AND tpd.tiktok_username != ''
ON CONFLICT (user_id, tiktok_username) DO NOTHING;

COMMIT;

-- Verify results
SELECT 
  'user_tiktok_usernames' as table_name,
  COUNT(*) as row_count
FROM public.user_tiktok_usernames;

-- Check matching employees now
SELECT 
  'Matching employees after backfill' as description,
  COUNT(DISTINCT ea.employee_id) as count
FROM public.employee_accounts ea
INNER JOIN public.user_tiktok_usernames utu ON utu.user_id = ea.employee_id;

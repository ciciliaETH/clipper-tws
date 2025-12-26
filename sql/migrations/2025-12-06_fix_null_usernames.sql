-- CRITICAL FIX: Delete auto-created junk accounts with NULL usernames
-- Date: 2025-12-06
--
-- Bug: fetch-ig and fetch-metrics auto-created users without proper usernames
-- These are junk accounts that should be deleted
--
-- Solution: Delete users with NULL username (except admins)

BEGIN;

-- Delete users with NULL username (these are auto-created junk accounts)
DELETE FROM public.users
WHERE username IS NULL
  AND role NOT IN ('admin', 'super_admin'); -- Keep admin accounts safe

COMMIT;

-- Verification query - run after migration to check results
-- SELECT 
--   role,
--   COUNT(*) as total,
--   COUNT(username) as with_username,
--   COUNT(*) FILTER (WHERE username IS NULL) as null_username
-- FROM public.users
-- GROUP BY role
-- ORDER BY role;


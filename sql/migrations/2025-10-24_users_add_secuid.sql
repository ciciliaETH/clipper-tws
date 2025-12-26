-- Add cached TikTok secUid to users table for fewer API calls
-- Date: 2025-10-24

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tiktok_sec_uid TEXT;

-- Optional helpful index
CREATE INDEX IF NOT EXISTS idx_users_tiktok_sec_uid ON public.users(tiktok_sec_uid);

COMMIT;

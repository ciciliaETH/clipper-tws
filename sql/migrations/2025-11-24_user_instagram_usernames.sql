-- Add instagram primary username and mapping table for multiple IG usernames per user
-- Date: 2025-11-24

BEGIN;

-- Re-introduce instagram_username on users for primary handle (safe if exists)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Mapping table: multiple instagram usernames per user
CREATE TABLE IF NOT EXISTS public.user_instagram_usernames (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, instagram_username)
);

CREATE INDEX IF NOT EXISTS user_instagram_usernames_username_idx
  ON public.user_instagram_usernames(instagram_username);

COMMIT;

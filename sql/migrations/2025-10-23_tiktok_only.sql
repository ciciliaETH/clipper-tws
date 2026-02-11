-- Clipper Dashboard Migration: TikTok-only focus
-- Date: 2025-10-23

BEGIN;

-- 1) USERS: ensure TikTok username column exists, remove unused columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tiktok_username TEXT;

-- Drop unused columns if they exist (safe to keep if you prefer)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'instagram_username'
  ) THEN
    ALTER TABLE public.users DROP COLUMN instagram_username CASCADE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'youtube_username'
  ) THEN
    ALTER TABLE public.users DROP COLUMN youtube_username;
  END IF;
END $$;

-- 2) SOCIAL_METRICS: align columns and constraints for TikTok-only
ALTER TABLE public.social_metrics
  ADD COLUMN IF NOT EXISTS followers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

-- Ensure unique key for upsert on (user_id, platform)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'idx_social_metrics_user_platform'
  ) THEN
    CREATE UNIQUE INDEX idx_social_metrics_user_platform 
      ON public.social_metrics (user_id, platform);
  END IF;
END $$;

-- Constrain platform to TikTok only
-- Try dropping common constraint names if they exist, then add a new one
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_check'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_ck'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_ck;
  END IF;
  -- Add new check constraint (skip if already exists)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'social_metrics_platform_tiktok_chk'
  ) THEN
    ALTER TABLE public.social_metrics 
      ADD CONSTRAINT social_metrics_platform_tiktok_chk CHECK (platform = 'tiktok');
  END IF;
END $$;

-- 3) TIKTOK_POSTS_DAILY: create table for daily post aggregates
CREATE TABLE IF NOT EXISTS public.tiktok_posts_daily (
  video_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  sec_uid TEXT,
  post_date DATE NOT NULL,
  comment_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  digg_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster campaign aggregations
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

-- 4) RLS policies updates for social_metrics
-- Allow users to update their own metrics
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Users can update own metrics'
  ) THEN
    CREATE POLICY "Users can update own metrics" ON public.social_metrics FOR UPDATE
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Allow admins to insert/update all metrics (for admin fetching others' data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Admin can insert all metrics'
  ) THEN
    CREATE POLICY "Admin can insert all metrics" ON public.social_metrics FOR INSERT
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Admin can update all metrics'
  ) THEN
    CREATE POLICY "Admin can update all metrics" ON public.social_metrics FOR UPDATE
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

-- 5) RPC: get_user_profile
-- Drop first to avoid return type mismatch errors if it already exists
DROP FUNCTION IF EXISTS public.get_user_profile();

CREATE OR REPLACE FUNCTION public.get_user_profile()
RETURNS public.users
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM public.users WHERE id = auth.uid();
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_profile() TO authenticated;

COMMIT;

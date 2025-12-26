-- Allow social_metrics to store Instagram platform in addition to TikTok
-- Date: 2025-11-24

BEGIN;

-- Drop old TikTok-only check constraints if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_tiktok_chk'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_tiktok_chk;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_check'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_check;
  END IF;
END $$;

-- Add new check constraint to allow both tiktok and instagram
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_metrics_platform_allowed_chk'
  ) THEN
    ALTER TABLE public.social_metrics
      ADD CONSTRAINT social_metrics_platform_allowed_chk CHECK (platform IN ('tiktok','instagram'));
  END IF;
END $$;

-- Ensure required columns exist (idempotent safeguard)
ALTER TABLE public.social_metrics
  ADD COLUMN IF NOT EXISTS followers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saves INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

-- Unique index on (user_id, platform) for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_social_metrics_user_platform'
  ) THEN
    CREATE UNIQUE INDEX idx_social_metrics_user_platform ON public.social_metrics(user_id, platform);
  END IF;
END $$;

COMMIT;

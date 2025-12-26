-- Align tiktok_posts_daily schema with backend expectations
-- Ensures primary key on video_id and required metric columns exist.

BEGIN;

-- Add required columns if missing
ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS video_id TEXT,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS sec_uid TEXT,
  ADD COLUMN IF NOT EXISTS post_date DATE,
  ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS digg_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Drop existing PK and/or id column if present, then set PK on video_id
DO $$
DECLARE
  pk_name text;
  has_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tiktok_posts_daily' AND column_name='id'
  ) INTO has_id;

  SELECT conname INTO pk_name FROM pg_constraint
  WHERE conrelid='public.tiktok_posts_daily'::regclass AND contype='p' LIMIT 1;

  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tiktok_posts_daily DROP CONSTRAINT %I', pk_name);
  END IF;

  IF has_id THEN
    ALTER TABLE public.tiktok_posts_daily DROP COLUMN IF EXISTS id;
  END IF;

  -- Ensure PK on video_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.tiktok_posts_daily'::regclass AND contype='p'
  ) THEN
    ALTER TABLE public.tiktok_posts_daily ADD CONSTRAINT tiktok_posts_daily_pkey PRIMARY KEY (video_id);
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

COMMIT;

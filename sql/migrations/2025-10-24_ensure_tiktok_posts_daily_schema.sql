-- Ensure tiktok_posts_daily table and required columns/PK exist
-- Date: 2025-10-24

BEGIN;

-- 1) Create table if missing
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

-- 2) Ensure columns exist (idempotent)
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS sec_uid TEXT;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS post_date DATE;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS digg_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3) Ensure PK on video_id exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tiktok_posts_daily'::regclass
      AND contype = 'p'
  ) THEN
    -- Drop duplicate video_id if any before setting PK (optional, skip for safety)
    ALTER TABLE public.tiktok_posts_daily ADD CONSTRAINT tiktok_posts_daily_pkey PRIMARY KEY (video_id);
  END IF;
END $$;

-- 4) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

COMMIT;

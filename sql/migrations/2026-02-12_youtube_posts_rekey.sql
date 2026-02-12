-- Re-key youtube_posts_daily to use user_id as id and move video id to video_id
-- Date: 2026-02-12

BEGIN;

-- 1) Rename current primary key column `id` (video id) to `video_id`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='youtube_posts_daily' AND column_name='id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='youtube_posts_daily' AND column_name='video_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.youtube_posts_daily RENAME COLUMN id TO video_id';
  END IF;
END $$;

-- 2) Add new `id` column to hold user_id (UUID)
ALTER TABLE public.youtube_posts_daily
  ADD COLUMN IF NOT EXISTS id UUID;

-- 3) Backfill id from mapping table user_youtube_channels (user_id ⇄ youtube_channel_id)
--    id = user_id, channel_id = youtube_channel_id
UPDATE public.youtube_posts_daily yp
SET id = uyc.user_id
FROM public.user_youtube_channels uyc
WHERE yp.channel_id = uyc.youtube_channel_id
  AND yp.id IS NULL;

-- 4) Drop existing primary key (likely on video_id) and create composite PK (id, video_id)
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name 
  FROM pg_constraint 
  WHERE conrelid='public.youtube_posts_daily'::regclass AND contype='p' LIMIT 1;

  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.youtube_posts_daily DROP CONSTRAINT %I', pk_name);
  END IF;

  -- Create composite primary key if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conrelid='public.youtube_posts_daily'::regclass AND contype='p'
  ) THEN
    EXECUTE 'ALTER TABLE public.youtube_posts_daily ADD CONSTRAINT youtube_posts_daily_pkey PRIMARY KEY (id, video_id)';
  END IF;
END $$;

-- 5) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_channel_date ON public.youtube_posts_daily(channel_id, post_date);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_post_date ON public.youtube_posts_daily(post_date);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_user ON public.youtube_posts_daily(id);

COMMIT;

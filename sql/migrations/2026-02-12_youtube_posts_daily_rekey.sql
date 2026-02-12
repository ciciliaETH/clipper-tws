-- Re-key youtube_posts_daily to (id=user_id, video_id)
-- and backfill video_id from old id, and id from user_youtube_channels

BEGIN;

-- 1) Add missing columns
ALTER TABLE public.youtube_posts_daily
  ADD COLUMN IF NOT EXISTS video_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2) Backfill video_id from previous primary key (video id)
UPDATE public.youtube_posts_daily
SET video_id = id
WHERE video_id IS NULL;

-- 3) Drop existing primary key on id (if any) and create composite (id, video_id)
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name
  FROM pg_constraint
  WHERE conrelid = 'public.youtube_posts_daily'::regclass AND contype='p'
  LIMIT 1;
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.youtube_posts_daily DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

-- 4) Backfill id with user_id based on mapping table
--    If mapping exists for channel_id, set id=user_id
UPDATE public.youtube_posts_daily y
SET id = m.user_id::text
FROM public.user_youtube_channels m
WHERE y.channel_id = m.youtube_channel_id
  AND (y.id IS DISTINCT FROM m.user_id::text);

-- 5) Ensure NOT NULL-ness for composite key columns
ALTER TABLE public.youtube_posts_daily
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN video_id SET NOT NULL;

-- 6) Create new composite primary key (user_id, video_id)
ALTER TABLE public.youtube_posts_daily
  ADD CONSTRAINT youtube_posts_daily_pkey PRIMARY KEY (id, video_id);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_channel_id ON public.youtube_posts_daily(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_post_date ON public.youtube_posts_daily(post_date);

COMMIT;

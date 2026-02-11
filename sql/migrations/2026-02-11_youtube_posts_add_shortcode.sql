-- Add shortcode column to youtube_posts_daily for cross-platform consistency
-- Date: 2026-02-11

BEGIN;

ALTER TABLE public.youtube_posts_daily
  ADD COLUMN IF NOT EXISTS shortcode TEXT;

-- Backfill existing rows: for YouTube, shortcode == video id
UPDATE public.youtube_posts_daily
  SET shortcode = id
  WHERE shortcode IS NULL;

-- Optional: index to speed lookups by shortcode
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_shortcode ON public.youtube_posts_daily(shortcode);

COMMIT;

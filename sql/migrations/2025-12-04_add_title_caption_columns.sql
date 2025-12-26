-- Add title and caption columns for hashtag filtering
-- Date: 2025-12-04

BEGIN;

-- Add title column to tiktok_posts_daily
ALTER TABLE public.tiktok_posts_daily 
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Add caption column to instagram_posts_daily
ALTER TABLE public.instagram_posts_daily 
  ADD COLUMN IF NOT EXISTS caption TEXT;

-- Create GIN indexes for faster text search (multi-language: simple config works for both EN & ID)
-- Using 'simple' config to support both English and Indonesian hashtags
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_title_gin 
  ON public.tiktok_posts_daily USING gin(to_tsvector('simple', COALESCE(title, '')));

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_caption_gin 
  ON public.instagram_posts_daily USING gin(to_tsvector('simple', COALESCE(caption, '')));

COMMIT;

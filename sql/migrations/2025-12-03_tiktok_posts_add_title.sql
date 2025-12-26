-- Add title column to tiktok_posts_daily for hashtag filtering
-- Date: 2025-12-03

BEGIN;

-- Add title column to store video title/caption (contains hashtags)
ALTER TABLE public.tiktok_posts_daily 
ADD COLUMN IF NOT EXISTS title TEXT;

-- Create GIN index for full-text search on hashtags
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_title_gin 
ON public.tiktok_posts_daily USING GIN (to_tsvector('simple', COALESCE(title, '')));

-- Regular index for pattern matching (hashtag search)
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_title 
ON public.tiktok_posts_daily (title) 
WHERE title IS NOT NULL;

COMMIT;

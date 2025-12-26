-- Add caption column to instagram_posts_daily for hashtag filtering
-- Date: 2025-12-03

BEGIN;

-- Add caption column to store post caption (contains hashtags)
ALTER TABLE public.instagram_posts_daily 
ADD COLUMN IF NOT EXISTS caption TEXT;

-- Create GIN index for full-text search on hashtags
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_caption_gin 
ON public.instagram_posts_daily USING GIN (to_tsvector('simple', COALESCE(caption, '')));

-- Regular index for pattern matching (hashtag search)
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_caption 
ON public.instagram_posts_daily (caption) 
WHERE caption IS NOT NULL;

COMMIT;

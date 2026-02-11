-- Add full-text and btree indexes for youtube_posts_daily.title
-- Purpose: fast hashtag/text search across YouTube video titles
-- Date: 2026-02-11

BEGIN;

-- Full-text search index (simple dictionary). No extension required.
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_title_gin
ON public.youtube_posts_daily
USING GIN (to_tsvector('simple', COALESCE(title, '')));

-- Btree index to accelerate prefix/equals filters when title is present
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_title
ON public.youtube_posts_daily (title)
WHERE title IS NOT NULL;

COMMIT;

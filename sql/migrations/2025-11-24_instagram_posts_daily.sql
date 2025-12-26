-- Instagram posts daily table for reels/posts aggregation
-- Date: 2025-11-24

BEGIN;

CREATE TABLE IF NOT EXISTS public.instagram_posts_daily (
  id TEXT PRIMARY KEY, -- prefer IG pk or id
  username TEXT NOT NULL,
  post_date DATE NOT NULL,
  play_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_user_date
  ON public.instagram_posts_daily(username, post_date);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_post_date ON public.instagram_posts_daily(post_date);

ALTER TABLE public.instagram_posts_daily ENABLE ROW LEVEL SECURITY;

COMMIT;

-- History snapshots for Instagram post metrics (for accrual calculations)
-- Captures totals at observation time, regardless of post_date
-- Date: 2025-12-01

BEGIN;

CREATE TABLE IF NOT EXISTS public.instagram_post_metrics_history (
  id BIGSERIAL PRIMARY KEY,
  post_id TEXT NOT NULL,
  username TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  play_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ig_post_hist_post_time ON public.instagram_post_metrics_history(post_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_post_hist_user_time ON public.instagram_post_metrics_history(username, captured_at DESC);

-- Trigger to snapshot every insert/update to instagram_posts_daily
CREATE OR REPLACE FUNCTION public.fn_log_instagram_post_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.instagram_post_metrics_history (post_id, username, captured_at, play_count, like_count, comment_count)
  VALUES (NEW.id, NEW.username, NOW(), NEW.play_count, NEW.like_count, NEW.comment_count);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_ig_post_snapshot ON public.instagram_posts_daily;
CREATE TRIGGER trg_log_ig_post_snapshot
AFTER INSERT OR UPDATE ON public.instagram_posts_daily
FOR EACH ROW EXECUTE FUNCTION public.fn_log_instagram_post_snapshot();

ALTER TABLE public.instagram_post_metrics_history ENABLE ROW LEVEL SECURITY;

COMMIT;

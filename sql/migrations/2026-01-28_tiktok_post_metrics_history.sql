-- Create TikTok Post Metrics History for Per-Post Accrual Tracking
-- Date: 2026-01-28
-- Purpose: Mirror Instagram's post_metrics_history for TikTok (consistency)

BEGIN;

-- ============================================================================
-- 1. Create History Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tiktok_post_metrics_history (
  id BIGSERIAL PRIMARY KEY,
  post_id TEXT NOT NULL,           -- video_id from tiktok_posts_daily
  username TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Snapshot of metrics at this time
  play_count BIGINT DEFAULT 0,
  digg_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  share_count BIGINT DEFAULT 0,
  save_count BIGINT DEFAULT 0,
  
  -- Post metadata (for reference)
  taken_at TIMESTAMPTZ,
  post_date DATE
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_tt_post_hist_post_time 
  ON public.tiktok_post_metrics_history(post_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_tt_post_hist_user_time 
  ON public.tiktok_post_metrics_history(username, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_tt_post_hist_captured 
  ON public.tiktok_post_metrics_history(captured_at DESC);

-- ============================================================================
-- 2. Create Trigger Function (Auto-populate on posts_daily update)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_log_tiktok_post_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.tiktok_post_metrics_history (
    post_id, 
    username, 
    captured_at, 
    play_count, 
    digg_count, 
    comment_count,
    share_count,
    save_count,
    taken_at,
    post_date
  )
  VALUES (
    NEW.video_id,
    NEW.username,
    NOW(),
    NEW.play_count,
    NEW.digg_count,
    NEW.comment_count,
    NEW.share_count,
    NEW.save_count,
    NEW.taken_at,
    NEW.post_date
  );
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 3. Create Trigger (Fire on INSERT or UPDATE)
-- ============================================================================
DROP TRIGGER IF EXISTS trg_log_tt_post_snapshot ON public.tiktok_posts_daily;

CREATE TRIGGER trg_log_tt_post_snapshot
AFTER INSERT OR UPDATE ON public.tiktok_posts_daily
FOR EACH ROW 
EXECUTE FUNCTION public.fn_log_tiktok_post_snapshot();

-- ============================================================================
-- 4. Enable RLS
-- ============================================================================
ALTER TABLE public.tiktok_post_metrics_history ENABLE ROW LEVEL SECURITY;

-- Allow public read (same as Instagram)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' 
      AND tablename='tiktok_post_metrics_history' 
      AND policyname='Public read tt post history'
  ) THEN
    CREATE POLICY "Public read tt post history" 
      ON public.tiktok_post_metrics_history FOR SELECT
      USING (true);
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- Verification Query
-- ============================================================================
SELECT 
  'tiktok_post_metrics_history' as table_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'tiktok_post_metrics_history'
  ) THEN '✅ Created' ELSE '❌ Not found' END as status
UNION ALL
SELECT 
  'Trigger: trg_log_tt_post_snapshot',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_log_tt_post_snapshot'
  ) THEN '✅ Active' ELSE '❌ Not found' END
UNION ALL
SELECT 
  'Function: fn_log_tiktok_post_snapshot',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'fn_log_tiktok_post_snapshot'
  ) THEN '✅ Exists' ELSE '❌ Not found' END;

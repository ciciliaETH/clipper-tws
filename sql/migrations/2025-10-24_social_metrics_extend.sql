-- Ensure social_metrics has aggregated columns and create history table for snapshots
-- Date: 2025-10-24

BEGIN;

-- Extend social_metrics with columns used by app (idempotent)
ALTER TABLE public.social_metrics
  ADD COLUMN IF NOT EXISTS followers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saves INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

-- History snapshots (append-only)
CREATE TABLE IF NOT EXISTS public.social_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  followers INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sm_hist_user_platform ON public.social_metrics_history(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_sm_hist_captured_at ON public.social_metrics_history(captured_at DESC);

COMMIT;

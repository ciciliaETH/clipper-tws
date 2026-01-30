-- Create Campaign Snapshot Tables for Weekly Historical Tracking
-- Date: 2026-01-28
-- Purpose: Store weekly snapshots of campaign participants for accrual mode calculations

BEGIN;

-- ============================================================================
-- 1. TikTok Campaign Participants Snapshot
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_tiktok_participants_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  aweme_id TEXT NOT NULL,  -- Video ID
  
  -- Snapshot of metrics at this date
  play_count BIGINT DEFAULT 0,
  digg_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  share_count BIGINT DEFAULT 0,
  save_count BIGINT DEFAULT 0,
  
  -- Post metadata
  post_date DATE,
  taken_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one snapshot per video per day per campaign
  UNIQUE(campaign_id, tiktok_username, aweme_id, snapshot_date)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_tt_snapshot_campaign_date 
  ON public.campaign_tiktok_participants_snapshot(campaign_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_tt_snapshot_username 
  ON public.campaign_tiktok_participants_snapshot(tiktok_username);
CREATE INDEX IF NOT EXISTS idx_tt_snapshot_video 
  ON public.campaign_tiktok_participants_snapshot(aweme_id, snapshot_date DESC);

-- RLS policies
ALTER TABLE public.campaign_tiktok_participants_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage tt snapshots' AND tablename='campaign_tiktok_participants_snapshot') THEN
    CREATE POLICY "Admin manage tt snapshots" ON public.campaign_tiktok_participants_snapshot FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read tt snapshots' AND tablename='campaign_tiktok_participants_snapshot') THEN
    CREATE POLICY "Public read tt snapshots" ON public.campaign_tiktok_participants_snapshot FOR SELECT
      USING (true);
  END IF;
END $$;

-- ============================================================================
-- 2. Instagram Campaign Participants Snapshot
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_instagram_participants_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  post_id TEXT NOT NULL,  -- Instagram post ID
  
  -- Snapshot of metrics at this date
  play_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  
  -- Post metadata
  post_date DATE,
  taken_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: one snapshot per post per day per campaign
  UNIQUE(campaign_id, instagram_username, post_id, snapshot_date)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_ig_snapshot_campaign_date 
  ON public.campaign_instagram_participants_snapshot(campaign_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_ig_snapshot_username 
  ON public.campaign_instagram_participants_snapshot(instagram_username);
CREATE INDEX IF NOT EXISTS idx_ig_snapshot_post 
  ON public.campaign_instagram_participants_snapshot(post_id, snapshot_date DESC);

-- RLS policies
ALTER TABLE public.campaign_instagram_participants_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage ig snapshots' AND tablename='campaign_instagram_participants_snapshot') THEN
    CREATE POLICY "Admin manage ig snapshots" ON public.campaign_instagram_participants_snapshot FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read ig snapshots' AND tablename='campaign_instagram_participants_snapshot') THEN
    CREATE POLICY "Public read ig snapshots" ON public.campaign_instagram_participants_snapshot FOR SELECT
      USING (true);
  END IF;
END $$;

COMMIT;

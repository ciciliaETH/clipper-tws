-- YouTube Platform Support
-- Date: 2026-02-09

BEGIN;

-- 1. Data Table: Store daily metrics for YouTube videos
CREATE TABLE IF NOT EXISTS public.youtube_posts_daily (
  id TEXT PRIMARY KEY, -- Video ID
  channel_id TEXT NOT NULL, -- Channel ID (e.g., UC...)
  title TEXT,
  post_date DATE NOT NULL,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_channel_date ON public.youtube_posts_daily(channel_id, post_date);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_post_date ON public.youtube_posts_daily(post_date);

ALTER TABLE public.youtube_posts_daily ENABLE ROW LEVEL SECURITY;

-- 2. Campaign Participants: Snapshot of channels in a campaign
CREATE TABLE IF NOT EXISTS public.campaign_youtube_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, youtube_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_youtube_parts_campaign ON public.campaign_youtube_participants(campaign_id);

ALTER TABLE public.campaign_youtube_participants ENABLE ROW LEVEL SECURITY;

-- 3. Employee Assignments: Link employee to channel for a campaign
CREATE TABLE IF NOT EXISTS public.employee_youtube_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, campaign_id, youtube_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_youtube_parts_campaign ON public.employee_youtube_participants(campaign_id);

ALTER TABLE public.employee_youtube_participants ENABLE ROW LEVEL SECURITY;

-- 4. User Channels: General mapping (optional but good for consistency)
CREATE TABLE IF NOT EXISTS public.user_youtube_channels (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, youtube_channel_id)
);

ALTER TABLE public.user_youtube_channels ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies (Basic Admin Access)
DO $$
BEGIN
  -- YouTube Posts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read youtube_posts_daily' AND tablename='youtube_posts_daily') THEN
    CREATE POLICY "Public read youtube_posts_daily" ON public.youtube_posts_daily FOR SELECT USING (true);
  END IF;
  
  -- Campaign Participants
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read campaign_youtube_participants' AND tablename='campaign_youtube_participants') THEN
    CREATE POLICY "Public read campaign_youtube_participants" ON public.campaign_youtube_participants FOR SELECT USING (true);
  END IF;

  -- Employee Assignments
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read employee_youtube_participants' AND tablename='employee_youtube_participants') THEN
    CREATE POLICY "Public read employee_youtube_participants" ON public.employee_youtube_participants FOR SELECT USING (true);
  END IF;
END $$;

COMMIT;

-- MAIN DATABASE SCHEMA (consolidated)
-- Generated: 2026-02-12
-- NOTE: Uses idempotent IF NOT EXISTS clauses to allow safe re-runs.
-- Focuses on structures referenced by the current application code.

BEGIN;

-- =========================
-- EXTENSIONS (if available)
-- =========================
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ======
-- USERS
-- ======
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  username TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','karyawan','umum','leader','super_admin')),
  full_name TEXT,
  tiktok_username TEXT,
  instagram_username TEXT,
  youtube_channel_id TEXT,
  tiktok_sec_uid TEXT,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON public.users((lower(username))) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON public.users((lower(email))) WHERE email IS NOT NULL;

-- ============================
-- USER HANDLE / CHANNEL MAPS
-- ============================
CREATE TABLE IF NOT EXISTS public.user_tiktok_usernames (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, tiktok_username)
);
CREATE INDEX IF NOT EXISTS idx_user_tiktok_usernames_username ON public.user_tiktok_usernames((lower(tiktok_username)));

CREATE TABLE IF NOT EXISTS public.user_instagram_usernames (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, instagram_username)
);
CREATE INDEX IF NOT EXISTS idx_user_instagram_usernames_username ON public.user_instagram_usernames((lower(instagram_username)));

CREATE TABLE IF NOT EXISTS public.user_youtube_channels (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, youtube_channel_id)
);
CREATE INDEX IF NOT EXISTS idx_user_youtube_channels_channel ON public.user_youtube_channels(youtube_channel_id);

-- Optional (used for nicer display of YouTube handles)
CREATE TABLE IF NOT EXISTS public.user_youtube_usernames (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  youtube_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, youtube_username)
);
CREATE INDEX IF NOT EXISTS idx_user_youtube_usernames_username ON public.user_youtube_usernames((lower(youtube_username)));

-- ====================
-- INSTAGRAM USER IDS
-- ====================
CREATE TABLE IF NOT EXISTS public.instagram_user_ids (
  instagram_username TEXT PRIMARY KEY,
  instagram_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_instagram_user_ids_user ON public.instagram_user_ids((lower(instagram_username)));

-- ======================
-- TIKTOK POSTS (DAILY)
-- ======================
CREATE TABLE IF NOT EXISTS public.tiktok_posts_daily (
  video_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  sec_uid TEXT,
  post_date DATE,
  taken_at TIMESTAMPTZ,
  title TEXT,
  comment_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  digg_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_taken_at ON public.tiktok_posts_daily(taken_at);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username_taken_at ON public.tiktok_posts_daily(username, taken_at);

-- =========================
-- INSTAGRAM POSTS (DAILY)
-- =========================
CREATE TABLE IF NOT EXISTS public.instagram_posts_daily (
  id TEXT PRIMARY KEY,
  code TEXT,
  username TEXT NOT NULL,
  post_date DATE,
  taken_at TIMESTAMPTZ,
  play_count BIGINT DEFAULT 0,
  like_count BIGINT DEFAULT 0,
  comment_count BIGINT DEFAULT 0,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_user_date ON public.instagram_posts_daily(username, post_date);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_post_date ON public.instagram_posts_daily(post_date);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_taken_at ON public.instagram_posts_daily(taken_at);
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_username_taken_at ON public.instagram_posts_daily(username, taken_at);

-- =======================
-- YOUTUBE POSTS (DAILY)
-- =======================
-- Composite PK: (id=user_id::text, video_id)
CREATE TABLE IF NOT EXISTS public.youtube_posts_daily (
  id TEXT NOT NULL, -- user_id as text
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  title TEXT,
  post_date DATE NOT NULL,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shortcode TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_channel_id ON public.youtube_posts_daily(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_post_date ON public.youtube_posts_daily(post_date);

-- ============
-- CAMPAIGNS
-- ============
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  required_hashtags TEXT[],
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Employee assignments per campaign
CREATE TABLE IF NOT EXISTS public.employee_groups (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_head BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (campaign_id, employee_id)
);

-- TikTok participants by employee
CREATE TABLE IF NOT EXISTS public.employee_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (employee_id, tiktok_username)
);
CREATE INDEX IF NOT EXISTS idx_employee_participants_username ON public.employee_participants((lower(tiktok_username)));

-- Instagram participants by employee
CREATE TABLE IF NOT EXISTS public.employee_instagram_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (employee_id, instagram_username)
);
CREATE INDEX IF NOT EXISTS idx_employee_instagram_participants_username ON public.employee_instagram_participants((lower(instagram_username)));

-- YouTube participants by employee per campaign
CREATE TABLE IF NOT EXISTS public.employee_youtube_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, campaign_id, youtube_channel_id)
);

-- Campaign participant pools
CREATE TABLE IF NOT EXISTS public.campaign_participants (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (campaign_id, tiktok_username)
);

CREATE TABLE IF NOT EXISTS public.campaign_instagram_participants (
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (campaign_id, instagram_username)
);

-- Optional snapshot table (lightweight)
CREATE TABLE IF NOT EXISTS public.campaign_instagram_participants_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Campaign YouTube participants
CREATE TABLE IF NOT EXISTS public.campaign_youtube_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, youtube_channel_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_youtube_parts_campaign ON public.campaign_youtube_participants(campaign_id);

-- ======================
-- REFRESH RETRY QUEUE
-- ======================
CREATE TABLE IF NOT EXISTS public.refresh_retry_queue (
  platform TEXT NOT NULL, -- 'tiktok' | 'instagram' | 'youtube'
  username TEXT NOT NULL,
  last_error TEXT,
  retry_count INTEGER DEFAULT 0,
  last_error_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  PRIMARY KEY (platform, username)
);
CREATE INDEX IF NOT EXISTS idx_refresh_retry_queue_due ON public.refresh_retry_queue(platform, next_retry_at);

-- ===============
-- ROW-LEVEL ACCESS
-- ===============
ALTER TABLE public.instagram_posts_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_posts_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_youtube_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_youtube_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_youtube_channels ENABLE ROW LEVEL SECURITY;

-- Basic public SELECT (adjust as needed for production)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read instagram_posts_daily' AND tablename='instagram_posts_daily') THEN
    CREATE POLICY "Public read instagram_posts_daily" ON public.instagram_posts_daily FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read youtube_posts_daily' AND tablename='youtube_posts_daily') THEN
    CREATE POLICY "Public read youtube_posts_daily" ON public.youtube_posts_daily FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read campaign_youtube_participants' AND tablename='campaign_youtube_participants') THEN
    CREATE POLICY "Public read campaign_youtube_participants" ON public.campaign_youtube_participants FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read employee_youtube_participants' AND tablename='employee_youtube_participants') THEN
    CREATE POLICY "Public read employee_youtube_participants" ON public.employee_youtube_participants FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Public read user_youtube_channels' AND tablename='user_youtube_channels') THEN
    CREATE POLICY "Public read user_youtube_channels" ON public.user_youtube_channels FOR SELECT USING (true);
  END IF;
END $$;

COMMIT;

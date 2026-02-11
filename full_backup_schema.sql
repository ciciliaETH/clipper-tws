-- Bootstrap all schema for Clipper Dashboard (TikTok + Instagram)
-- Run this once on a fresh Supabase/Postgres project (SQL Editor)
-- Recommended role: postgres (to allow extensions and policies)

-- ============================
-- 0) Extensions (safe to run)
-- ============================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;         -- used by cron/HTTP
CREATE EXTENSION IF NOT EXISTS pg_cron;        -- only if you plan to use cron scripts

-- =====================================================================================
-- The following blocks are a concatenation of migration files in chronological order.
-- Each block manages its own transaction (BEGIN/COMMIT) and is idempotent when possible.
-- =====================================================================================

-- Bootstrap base users table (app-level users), required by later migrations
-- Supabase auth users live in auth.users; this is an application profile table.
BEGIN;
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  username TEXT,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'umum',
  tiktok_username TEXT,
  tiktok_sec_uid TEXT,
  instagram_username TEXT,
  profile_picture_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMIT;

-- Ensure required profile columns exist on existing installations
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
COMMIT;

-- Bootstrap base social_metrics table (required before ALTER and policies)
BEGIN;
CREATE TABLE IF NOT EXISTS public.social_metrics (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  followers INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMIT;

-- 2025-10-23_tiktok_only.sql
-- Clipper Dashboard Migration: TikTok-only focus
-- Date: 2025-10-23

BEGIN;

-- 1) USERS: ensure TikTok username column exists, remove unused columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tiktok_username TEXT;

-- Drop unused columns if they exist (safe to keep if you prefer)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'instagram_username'
  ) THEN
    ALTER TABLE public.users DROP COLUMN instagram_username CASCADE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'youtube_username'
  ) THEN
    ALTER TABLE public.users DROP COLUMN youtube_username;
  END IF;
END $$;

-- 2) SOCIAL_METRICS: align columns and constraints for TikTok-only
ALTER TABLE public.social_metrics
  ADD COLUMN IF NOT EXISTS followers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

-- Ensure unique key for upsert on (user_id, platform)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'idx_social_metrics_user_platform'
  ) THEN
    CREATE UNIQUE INDEX idx_social_metrics_user_platform 
      ON public.social_metrics (user_id, platform);
  END IF;
END $$;

-- Constrain platform to TikTok only
-- Try dropping common constraint names if they exist, then add a new one
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_check'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_ck'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_ck;
  END IF;
  -- Add new check constraint (skip if already exists)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'social_metrics_platform_tiktok_chk'
  ) THEN
    ALTER TABLE public.social_metrics 
      ADD CONSTRAINT social_metrics_platform_tiktok_chk CHECK (platform = 'tiktok');
  END IF;
END $$;

-- 3) TIKTOK_POSTS_DAILY: create table for daily post aggregates
CREATE TABLE IF NOT EXISTS public.tiktok_posts_daily (
  video_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  sec_uid TEXT,
  post_date DATE NOT NULL,
  comment_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  digg_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster campaign aggregations
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

-- 4) RLS policies updates for social_metrics
-- Allow users to update their own metrics
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Users can update own metrics'
  ) THEN
    CREATE POLICY "Users can update own metrics" ON public.social_metrics FOR UPDATE
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Allow admins to insert/update all metrics (for admin fetching others' data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Admin can insert all metrics'
  ) THEN
    CREATE POLICY "Admin can insert all metrics" ON public.social_metrics FOR INSERT
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Admin can update all metrics'
  ) THEN
    CREATE POLICY "Admin can update all metrics" ON public.social_metrics FOR UPDATE
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

-- 5) RPC: get_user_profile
-- Drop first to avoid return type mismatch errors if it already exists
DROP FUNCTION IF EXISTS public.get_user_profile();

CREATE OR REPLACE FUNCTION public.get_user_profile()
RETURNS public.users
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM public.users WHERE id = auth.uid();
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_profile() TO authenticated;

COMMIT;

-- 2025-10-23_campaigns.sql
BEGIN;

-- Campaigns table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign participants (supports internal user or external by username)
CREATE TABLE IF NOT EXISTS public.campaign_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_participants_campaign ON public.campaign_participants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_participants_username ON public.campaign_participants(tiktok_username);

-- RLS: enable if you want anon access to be restricted
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_participants ENABLE ROW LEVEL SECURITY;

-- Admin can manage all
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage campaigns' AND tablename='campaigns') THEN
    CREATE POLICY "Admin manage campaigns" ON public.campaigns FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage campaign_participants' AND tablename='campaign_participants') THEN
    CREATE POLICY "Admin manage campaign_participants" ON public.campaign_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;

-- 2025-10-23_campaign_metrics_fn.sql
BEGIN;

-- Series aggregation by interval
CREATE OR REPLACE FUNCTION public.campaign_series(
  campaign UUID,
  start_date DATE,
  end_date DATE,
  p_interval TEXT DEFAULT 'daily'
)
RETURNS TABLE(
  bucket_date DATE,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH usernames AS (
  SELECT LOWER(tiktok_username) AS username
  FROM public.campaign_participants
  WHERE campaign_id = campaign
), posts AS (
  SELECT p.post_date::date AS d,
         p.play_count::bigint AS views,
         p.digg_count::bigint AS likes,
         p.comment_count::bigint AS comments,
         p.share_count::bigint AS shares,
         p.save_count::bigint AS saves
  FROM public.tiktok_posts_daily p
  JOIN usernames u ON u.username = p.username
  WHERE p.post_date BETWEEN start_date AND end_date
)
SELECT
  CASE
    WHEN p_interval = 'weekly' THEN date_trunc('week', d)::date
    WHEN p_interval = 'monthly' THEN date_trunc('month', d)::date
    ELSE d
  END AS bucket_date,
  SUM(views) AS views,
  SUM(likes) AS likes,
  SUM(comments) AS comments,
  SUM(shares) AS shares,
  SUM(saves) AS saves
FROM posts
GROUP BY 1
ORDER BY 1;
$$;

-- Participant totals ranking
CREATE OR REPLACE FUNCTION public.campaign_participant_totals(
  campaign UUID,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
SELECT p.username,
       SUM(p.play_count)::bigint AS views,
       SUM(p.digg_count)::bigint AS likes,
       SUM(p.comment_count)::bigint AS comments,
       SUM(p.share_count)::bigint AS shares,
       SUM(p.save_count)::bigint AS saves
FROM public.tiktok_posts_daily p
JOIN public.campaign_participants cp ON LOWER(cp.tiktok_username) = p.username
WHERE cp.campaign_id = campaign
  AND p.post_date BETWEEN start_date AND end_date
GROUP BY p.username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_series(UUID, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_participant_totals(UUID, DATE, DATE) TO authenticated;

COMMIT;

-- 2025-10-24_employee_accounts.sql
BEGIN;

-- Mapping table: which employee handles which umum-account
CREATE TABLE IF NOT EXISTS public.employee_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_accounts_pair ON public.employee_accounts(employee_id, account_user_id);

ALTER TABLE public.employee_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_accounts' AND tablename='employee_accounts') THEN
    CREATE POLICY "Admin manage employee_accounts" ON public.employee_accounts FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

-- Helper aggregation for a list of usernames within a date range
CREATE OR REPLACE FUNCTION public.user_totals_in_range(
  usernames TEXT[],
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
SELECT p.username,
       SUM(p.play_count)::bigint AS views,
       SUM(p.digg_count)::bigint AS likes,
       SUM(p.comment_count)::bigint AS comments,
       SUM(p.share_count)::bigint AS shares,
       SUM(p.save_count)::bigint AS saves
FROM public.tiktok_posts_daily p
WHERE p.username = ANY (usernames)
  AND p.post_date BETWEEN start_date AND end_date
GROUP BY p.username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.user_totals_in_range(TEXT[], DATE, DATE) TO authenticated;

COMMIT;

-- 2025-10-24_ensure_tiktok_posts_daily_schema.sql
BEGIN;

-- 1) Create table if missing
CREATE TABLE IF NOT EXISTS public.tiktok_posts_daily (
  video_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  sec_uid TEXT,
  post_date DATE NOT NULL,
  comment_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  digg_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Ensure columns exist (idempotent)
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS sec_uid TEXT;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS post_date DATE;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS digg_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3) Ensure PK on video_id exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tiktok_posts_daily'::regclass
      AND contype = 'p'
  ) THEN
    -- Drop duplicate video_id if any before setting PK (optional, skip for safety)
    ALTER TABLE public.tiktok_posts_daily ADD CONSTRAINT tiktok_posts_daily_pkey PRIMARY KEY (video_id);
  END IF;
END $$;

-- 4) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

COMMIT;

-- 2025-10-24_leaderboard_fn.sql
BEGIN;

-- Drop existing function first because return type changed
DROP FUNCTION IF EXISTS public.leaderboard_tiktok(TEXT, DATE, DATE, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.leaderboard_tiktok(
  metric TEXT,
  start_date DATE,
  end_date DATE,
  top_n INTEGER DEFAULT 15,
  campaign UUID DEFAULT NULL
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH base AS (
  SELECT LOWER(tp.username) AS username,
         COALESCE(SUM(tp.play_count),0)::bigint AS views,
         COALESCE(SUM(tp.digg_count),0)::bigint AS likes,
         COALESCE(SUM(tp.comment_count),0)::bigint AS comments,
         COALESCE(SUM(tp.share_count),0)::bigint AS shares,
         COALESCE(SUM(tp.save_count),0)::bigint AS saves,
         (COALESCE(SUM(tp.play_count),0)
        + COALESCE(SUM(tp.digg_count),0)
        + COALESCE(SUM(tp.comment_count),0)
        + COALESCE(SUM(tp.share_count),0)
        + COALESCE(SUM(tp.save_count),0))::bigint AS total
  FROM public.tiktok_posts_daily tp
  JOIN public.users u
    ON LOWER(u.tiktok_username) = LOWER(tp.username)
   AND u.role = 'umum'
  WHERE tp.post_date BETWEEN start_date AND end_date
  GROUP BY 1
), filtered AS (
  SELECT b.*
  FROM base b
  WHERE campaign IS NULL
     OR EXISTS (
       SELECT 1 FROM public.campaign_participants cp
       WHERE cp.campaign_id = campaign
         AND LOWER(cp.tiktok_username) = b.username
     )
)
SELECT *
FROM filtered
ORDER BY CASE
           WHEN metric = 'likes' THEN likes
           WHEN metric = 'comments' THEN comments
           WHEN metric = 'shares' THEN shares
           WHEN metric = 'saves' THEN saves
           WHEN metric = 'views' THEN views
           ELSE total -- default or 'total'
         END DESC NULLS LAST
LIMIT top_n;
$$;

GRANT EXECUTE ON FUNCTION public.leaderboard_tiktok(TEXT, DATE, DATE, INTEGER, UUID) TO authenticated;

COMMIT;

-- 2025-10-24_social_metrics_extend.sql
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

-- 2025-10-24_users_add_secuid.sql
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tiktok_sec_uid TEXT;

CREATE INDEX IF NOT EXISTS idx_users_tiktok_sec_uid ON public.users(tiktok_sec_uid);

COMMIT;

-- 2025-10-24_fix_tiktok_posts_daily.sql
BEGIN;

ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;

COMMIT;

-- 2025-11-20_employee_groups.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_groups_pair ON public.employee_groups(employee_id, campaign_id);

ALTER TABLE public.employee_groups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_groups' AND tablename='employee_groups') THEN
    CREATE POLICY "Admin manage employee_groups" ON public.employee_groups FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;

-- 2025-11-20_employee_participants.sql
-- 2025-11-20_employee_participants_unique.sql
BEGIN;

create table if not exists employee_participants (
  employee_id uuid not null references users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  tiktok_username text not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, campaign_id, tiktok_username)
);

create index if not exists employee_participants_campaign_idx on employee_participants(campaign_id);
create index if not exists employee_participants_username_idx on employee_participants(tiktok_username);

create unique index if not exists employee_participants_unique_campaign_username
  on employee_participants(campaign_id, tiktok_username);

COMMIT;

-- 2025-11-20_user_tiktok_usernames.sql
BEGIN;

create table if not exists user_tiktok_usernames (
  user_id uuid not null references users(id) on delete cascade,
  tiktok_username text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tiktok_username)
);
create index if not exists user_tiktok_usernames_username_idx on user_tiktok_usernames(tiktok_username);

COMMIT;

-- 2025-11-21_fix_tiktok_posts_daily_schema.sql
BEGIN;

ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS video_id TEXT,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS sec_uid TEXT,
  ADD COLUMN IF NOT EXISTS post_date DATE,
  ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS digg_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
DECLARE
  pk_name text;
  has_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tiktok_posts_daily' AND column_name='id'
  ) INTO has_id;

  SELECT conname INTO pk_name FROM pg_constraint
  WHERE conrelid='public.tiktok_posts_daily'::regclass AND contype='p' LIMIT 1;

  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tiktok_posts_daily DROP CONSTRAINT %I', pk_name);
  END IF;

  IF has_id THEN
    ALTER TABLE public.tiktok_posts_daily DROP COLUMN IF EXISTS id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.tiktok_posts_daily'::regclass AND contype='p'
  ) THEN
    ALTER TABLE public.tiktok_posts_daily ADD CONSTRAINT tiktok_posts_daily_pkey PRIMARY KEY (video_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

COMMIT;

-- 2025-11-21_groups.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, employee_id)
);

CREATE TABLE IF NOT EXISTS public.group_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, tiktok_username)
);
CREATE INDEX IF NOT EXISTS idx_group_participants_group ON public.group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_username ON public.group_participants(tiktok_username);

CREATE TABLE IF NOT EXISTS public.group_participant_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  followers BIGINT DEFAULT 0,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  saves BIGINT DEFAULT 0,
  posts_total INTEGER DEFAULT 0,
  metrics_json JSONB,
  last_refreshed TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, tiktok_username)
);
CREATE INDEX IF NOT EXISTS idx_group_participant_snapshots_group ON public.group_participant_snapshots(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participant_snapshots_username ON public.group_participant_snapshots(tiktok_username);

CREATE OR REPLACE VIEW public.group_leaderboard AS
SELECT
  gps.group_id,
  gps.tiktok_username,
  gps.followers,
  gps.views,
  gps.likes,
  gps.comments,
  gps.shares,
  gps.saves,
  gps.posts_total,
  (COALESCE(gps.views,0)+COALESCE(gps.likes,0)+COALESCE(gps.comments,0)+COALESCE(gps.shares,0)+COALESCE(gps.saves,0)) AS total,
  gps.last_refreshed
FROM public.group_participant_snapshots gps;

CREATE OR REPLACE FUNCTION public.upsert_group_participant_snapshot(
  p_group_id UUID,
  p_tiktok_username TEXT,
  p_followers BIGINT,
  p_views BIGINT,
  p_likes BIGINT,
  p_comments BIGINT,
  p_shares BIGINT,
  p_saves BIGINT,
  p_posts_total INTEGER,
  p_metrics_json JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.group_participant_snapshots (
    group_id, tiktok_username, followers, views, likes, comments, shares, saves, posts_total, metrics_json, last_refreshed
  ) VALUES (
    p_group_id, LOWER(REGEXP_REPLACE(p_tiktok_username, '^@', '')), p_followers, p_views, p_likes, p_comments, p_shares, p_saves, p_posts_total, p_metrics_json, NOW()
  )
  ON CONFLICT (group_id, tiktok_username) DO UPDATE SET
    followers = EXCLUDED.followers,
    views = EXCLUDED.views,
    likes = EXCLUDED.likes,
    comments = EXCLUDED.comments,
    shares = EXCLUDED.shares,
    saves = EXCLUDED.saves,
    posts_total = EXCLUDED.posts_total,
    metrics_json = EXCLUDED.metrics_json,
    last_refreshed = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_participant_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage groups' AND tablename='groups') THEN
    CREATE POLICY "Admin manage groups" ON public.groups FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage group_members' AND tablename='group_members') THEN
    CREATE POLICY "Admin manage group_members" ON public.group_members FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage group_participants' AND tablename='group_participants') THEN
    CREATE POLICY "Admin manage group_participants" ON public.group_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage group_participant_snapshots' AND tablename='group_participant_snapshots') THEN
    CREATE POLICY "Admin manage group_participant_snapshots" ON public.group_participant_snapshots FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;

-- 2025-11-24_instagram_posts_daily.sql
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

-- 2025-11-24_instagram_user_ids.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.instagram_user_ids (
  instagram_username TEXT PRIMARY KEY,
  instagram_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.instagram_user_ids ENABLE ROW LEVEL SECURITY;

COMMIT;

-- 2025-11-24_user_instagram_usernames.sql
BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

CREATE TABLE IF NOT EXISTS public.user_instagram_usernames (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, instagram_username)
);

CREATE INDEX IF NOT EXISTS user_instagram_usernames_username_idx
  ON public.user_instagram_usernames(instagram_username);

COMMIT;

-- 2025-11-24_employee_instagram_participants.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_instagram_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, campaign_id, instagram_username)
);

CREATE INDEX IF NOT EXISTS employee_instagram_participants_campaign_idx ON public.employee_instagram_participants(campaign_id);
CREATE INDEX IF NOT EXISTS employee_instagram_participants_username_idx ON public.employee_instagram_participants(instagram_username);

ALTER TABLE public.employee_instagram_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_instagram_participants' AND tablename='employee_instagram_participants') THEN
    CREATE POLICY "Admin manage employee_instagram_participants" ON public.employee_instagram_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;

-- 2026-01-28_employee_tiktok_participants.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_tiktok_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, campaign_id, tiktok_username)
);

CREATE INDEX IF NOT EXISTS employee_tiktok_participants_campaign_idx ON public.employee_tiktok_participants(campaign_id);
CREATE INDEX IF NOT EXISTS employee_tiktok_participants_username_idx ON public.employee_tiktok_participants(tiktok_username);

ALTER TABLE public.employee_tiktok_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_tiktok_participants' AND tablename='employee_tiktok_participants') THEN
    CREATE POLICY "Admin manage employee_tiktok_participants" ON public.employee_tiktok_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;

-- 2025-11-24_campaign_instagram_participants.sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_instagram_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_ig_participant ON public.campaign_instagram_participants(campaign_id, instagram_username);
CREATE INDEX IF NOT EXISTS idx_campaign_ig_participants_campaign ON public.campaign_instagram_participants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_ig_participants_username ON public.campaign_instagram_participants(instagram_username);

ALTER TABLE public.campaign_instagram_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage campaign_instagram_participants' AND tablename='campaign_instagram_participants') THEN
    CREATE POLICY "Admin manage campaign_instagram_participants" ON public.campaign_instagram_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;

-- 2025-11-24_campaign_instagram_participants_snapshot.sql
BEGIN;

ALTER TABLE public.campaign_instagram_participants
  ADD COLUMN IF NOT EXISTS followers BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_json JSONB,
  ADD COLUMN IF NOT EXISTS last_refreshed TIMESTAMPTZ;

COMMIT;

-- 2025-12-01_instagram_post_metrics_history.sql
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

-- 2025-12-04_supabase_storage_avatars.sql (policies for avatars bucket)
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can upload own profile pictures'
  ) THEN
    CREATE POLICY "Users can upload own profile pictures"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Anyone can view avatars'
  ) THEN
    CREATE POLICY "Anyone can view avatars"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'avatars');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can update own profile pictures'
  ) THEN
    CREATE POLICY "Users can update own profile pictures"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    )
    WITH CHECK (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can delete own profile pictures'
  ) THEN
    CREATE POLICY "Users can delete own profile pictures"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

COMMIT;

-- 2025-12-09_refresh_retry_queue.sql
-- Persistent retry queue for platform refreshes
create table if not exists refresh_retry_queue (
  id bigserial primary key,
  platform text not null check (platform in ('tiktok','instagram')),
  username text not null,
  last_error text,
  retry_count int not null default 0,
  next_retry_at timestamptz not null default now(),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, username)
);

create index if not exists idx_refresh_retry_queue_due on refresh_retry_queue(platform, next_retry_at);

create or replace function set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgrelid = 'public.refresh_retry_queue'::regclass 
      AND tgname = 'trg_refresh_retry_queue_updated_at'
  ) THEN
    CREATE TRIGGER trg_refresh_retry_queue_updated_at
    BEFORE UPDATE ON refresh_retry_queue
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
  END IF;
END $$;

-- 2026-01-06_weekly_historical_data.sql
CREATE TABLE IF NOT EXISTS weekly_historical_data (
  id BIGSERIAL PRIMARY KEY,
  week_label TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  week_num INTEGER NOT NULL,
  campaign_id TEXT,
  group_name TEXT,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'all')),
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  saves BIGINT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_label, year, month, week_num, campaign_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_weekly_hist_dates ON weekly_historical_data(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_weekly_hist_campaign ON weekly_historical_data(campaign_id);
CREATE INDEX IF NOT EXISTS idx_weekly_hist_platform ON weekly_historical_data(platform);
CREATE INDEX IF NOT EXISTS idx_weekly_hist_year_month ON weekly_historical_data(year, month);

ALTER TABLE weekly_historical_data ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='weekly_historical_data' AND policyname='Allow public read on weekly_historical_data'
  ) THEN
    CREATE POLICY "Allow public read on weekly_historical_data" ON public.weekly_historical_data
      FOR SELECT USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='weekly_historical_data' AND policyname='Allow authenticated write on weekly_historical_data'
  ) THEN
    CREATE POLICY "Allow authenticated write on weekly_historical_data" ON public.weekly_historical_data
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_weekly_historical_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS weekly_historical_updated_at_trigger ON weekly_historical_data;
CREATE TRIGGER weekly_historical_updated_at_trigger
  BEFORE UPDATE ON weekly_historical_data
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_historical_updated_at();

CREATE OR REPLACE FUNCTION parse_week_label(label TEXT, year_val INTEGER)
RETURNS TABLE(start_date DATE, end_date DATE, month_num INTEGER, week_num INTEGER) AS $$
DECLARE
  month_name TEXT;
  week_str TEXT;
  week_number INTEGER;
  month_number INTEGER;
  month_start DATE;
  week_start DATE;
BEGIN
  week_str := SUBSTRING(label FROM 'W(\d+)');
  month_name := TRIM(SUBSTRING(label FROM 'W\d+\s+(.+)'));
  week_number := week_str::INTEGER;

  month_number := CASE LOWER(month_name)
    WHEN 'januari' THEN 1
    WHEN 'februari' THEN 2
    WHEN 'maret' THEN 3
    WHEN 'april' THEN 4
    WHEN 'mei' THEN 5
    WHEN 'juni' THEN 6
    WHEN 'juli' THEN 7
    WHEN 'agustus' THEN 8
    WHEN 'september' THEN 9
    WHEN 'oktober' THEN 10
    WHEN 'november' THEN 11
    WHEN 'desember' THEN 12
    ELSE NULL
  END;

  IF month_number IS NULL THEN
    RAISE EXCEPTION 'Invalid month name: %', month_name;
  END IF;

  week_start := DATE(year_val || '-' || month_number || '-01') + ((week_number - 1) * 7);

  RETURN QUERY SELECT 
    week_start AS start_date,
    LEAST(week_start + 6, (DATE(year_val || '-' || month_number || '-01') + INTERVAL '1 month' - INTERVAL '1 day')::DATE) AS end_date,
    month_number AS month_num,
    week_number AS week_num;
END;
$$ LANGUAGE plpgsql;

-- 2026-01-09_instagram_add_taken_at.sql
BEGIN;

ALTER TABLE public.instagram_posts_daily 
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_taken_at 
  ON public.instagram_posts_daily(taken_at);

ALTER TABLE public.tiktok_posts_daily 
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_taken_at 
  ON public.tiktok_posts_daily(taken_at);

COMMIT;

-- supabase/sql/instagram_normalize_backfill.sql (normalization + triggers + backfill)
-- You can safely re-run this. It includes updates and trigger creations.

-- Helpers
create or replace function strip_at_lower(t text)
returns text language sql immutable as $$
  select case when t is null then null else lower(regexp_replace(t, '^@+', '')) end
$$;

-- One-time normalization
update instagram_posts_daily
set username = strip_at_lower(username)
where username is not null and (username ~ '^@' or username <> lower(username));

update user_instagram_usernames
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

update campaign_instagram_participants
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

update employee_instagram_participants
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

update users
set instagram_username = strip_at_lower(instagram_username)
where instagram_username is not null and (instagram_username ~ '^@' or instagram_username <> lower(instagram_username));

-- Triggers
DROP TRIGGER IF EXISTS trg_norm_ig_posts ON instagram_posts_daily;
create or replace function trg_norm_ig_posts_fn()
returns trigger language plpgsql as $$
begin
  new.username := strip_at_lower(new.username);
  return new;
end$$;
create trigger trg_norm_ig_posts
before insert or update on instagram_posts_daily
for each row execute function trg_norm_ig_posts_fn();

create or replace function trg_norm_map_fn()
returns trigger language plpgsql as $$
begin
  new.instagram_username := strip_at_lower(new.instagram_username);
  return new;
end$$;

DROP TRIGGER IF EXISTS trg_norm_map ON user_instagram_usernames;
create trigger trg_norm_map
before insert or update on user_instagram_usernames
for each row execute function trg_norm_map_fn();

DROP TRIGGER IF EXISTS trg_norm_camp_ig ON campaign_instagram_participants;
create trigger trg_norm_camp_ig
before insert or update on campaign_instagram_participants
for each row execute function trg_norm_map_fn();

DROP TRIGGER IF EXISTS trg_norm_emp_ig ON employee_instagram_participants;
create trigger trg_norm_emp_ig
before insert or update on employee_instagram_participants
for each row execute function trg_norm_map_fn();

DROP TRIGGER IF EXISTS trg_norm_users_ig ON users;
create or replace function trg_norm_users_ig_fn()
returns trigger language plpgsql as $$
begin
  if new.instagram_username is not null then
    new.instagram_username := strip_at_lower(new.instagram_username);
  end if;
  return new;
end$$;
create trigger trg_norm_users_ig
before insert or update on users
for each row execute function trg_norm_users_ig_fn();

-- Backfill maps
insert into employee_instagram_participants (employee_id, campaign_id, instagram_username)
select eg.employee_id,
       eg.campaign_id,
       strip_at_lower(us.instagram_username)
from employee_groups eg
join users us on us.id = eg.employee_id
where strip_at_lower(us.instagram_username) is not null
on conflict (employee_id, campaign_id, instagram_username) do nothing;

insert into employee_instagram_participants (employee_id, campaign_id, instagram_username)
select eg.employee_id,
       eg.campaign_id,
       strip_at_lower(ui.instagram_username)
from employee_groups eg
join user_instagram_usernames ui on ui.user_id = eg.employee_id
where strip_at_lower(ui.instagram_username) is not null
on conflict (employee_id, campaign_id, instagram_username) do nothing;

insert into campaign_instagram_participants (campaign_id, instagram_username)
select distinct eip.campaign_id, eip.instagram_username
from employee_instagram_participants eip
on conflict (campaign_id, instagram_username) do nothing;

-- Indexes
create index if not exists idx_ig_posts_username_date on instagram_posts_daily (username, post_date);
create index if not exists idx_emp_ig_part_employee on employee_instagram_participants (employee_id, campaign_id);
create index if not exists idx_camp_ig_part on campaign_instagram_participants (campaign_id, instagram_username);
create index if not exists idx_user_ig_alias on user_instagram_usernames (user_id, instagram_username);
-- SQL functions for fast campaign aggregations using GROUP BY
-- Date: 2025-10-23

BEGIN;

-- Series aggregation by interval
CREATE OR REPLACE FUNCTION public.campaign_series(
  campaign UUID,
  start_date DATE,
  end_date DATE,
  p_interval TEXT DEFAULT 'daily'
)
RETURNS TABLE(
  bucket_date DATE,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH usernames AS (
  SELECT LOWER(tiktok_username) AS username
  FROM public.campaign_participants
  WHERE campaign_id = campaign
), posts AS (
  SELECT p.post_date::date AS d,
         p.play_count::bigint AS views,
         p.digg_count::bigint AS likes,
         p.comment_count::bigint AS comments,
         p.share_count::bigint AS shares,
         p.save_count::bigint AS saves
  FROM public.tiktok_posts_daily p
  JOIN usernames u ON u.username = p.username
  WHERE p.post_date BETWEEN start_date AND end_date
)
SELECT
  CASE
    WHEN p_interval = 'weekly' THEN date_trunc('week', d)::date
    WHEN p_interval = 'monthly' THEN date_trunc('month', d)::date
    ELSE d
  END AS bucket_date,
  SUM(views) AS views,
  SUM(likes) AS likes,
  SUM(comments) AS comments,
  SUM(shares) AS shares,
  SUM(saves) AS saves
FROM posts
GROUP BY 1
ORDER BY 1;
$$;

-- Participant totals ranking
CREATE OR REPLACE FUNCTION public.campaign_participant_totals(
  campaign UUID,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
SELECT p.username,
       SUM(p.play_count)::bigint AS views,
       SUM(p.digg_count)::bigint AS likes,
       SUM(p.comment_count)::bigint AS comments,
       SUM(p.share_count)::bigint AS shares,
       SUM(p.save_count)::bigint AS saves
FROM public.tiktok_posts_daily p
JOIN public.campaign_participants cp ON LOWER(cp.tiktok_username) = p.username
WHERE cp.campaign_id = campaign
  AND p.post_date BETWEEN start_date AND end_date
GROUP BY p.username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_series(UUID, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_participant_totals(UUID, DATE, DATE) TO authenticated;

COMMIT;
-- Clipper Dashboard Migration: Campaigns for TikTok analytics
-- Date: 2025-10-23

BEGIN;

-- Campaigns table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign participants (supports internal user or external by username)
CREATE TABLE IF NOT EXISTS public.campaign_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_participants_campaign ON public.campaign_participants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_participants_username ON public.campaign_participants(tiktok_username);

-- RLS: enable if you want anon access to be restricted
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_participants ENABLE ROW LEVEL SECURITY;

-- Admin can manage all
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage campaigns' AND tablename='campaigns') THEN
    CREATE POLICY "Admin manage campaigns" ON public.campaigns FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage campaign_participants' AND tablename='campaign_participants') THEN
    CREATE POLICY "Admin manage campaign_participants" ON public.campaign_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;
-- Clipper Dashboard Migration: TikTok-only focus
-- Date: 2025-10-23

BEGIN;

-- 1) USERS: ensure TikTok username column exists, remove unused columns
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tiktok_username TEXT;

-- Drop unused columns if they exist (safe to keep if you prefer)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'instagram_username'
  ) THEN
    ALTER TABLE public.users DROP COLUMN instagram_username CASCADE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'youtube_username'
  ) THEN
    ALTER TABLE public.users DROP COLUMN youtube_username;
  END IF;
END $$;

-- 2) SOCIAL_METRICS: align columns and constraints for TikTok-only
ALTER TABLE public.social_metrics
  ADD COLUMN IF NOT EXISTS followers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

-- Ensure unique key for upsert on (user_id, platform)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'idx_social_metrics_user_platform'
  ) THEN
    CREATE UNIQUE INDEX idx_social_metrics_user_platform 
      ON public.social_metrics (user_id, platform);
  END IF;
END $$;

-- Constrain platform to TikTok only
-- Try dropping common constraint names if they exist, then add a new one
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_check'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_ck'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_ck;
  END IF;
  -- Add new check constraint (skip if already exists)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'social_metrics_platform_tiktok_chk'
  ) THEN
    ALTER TABLE public.social_metrics 
      ADD CONSTRAINT social_metrics_platform_tiktok_chk CHECK (platform = 'tiktok');
  END IF;
END $$;

-- 3) TIKTOK_POSTS_DAILY: create table for daily post aggregates
CREATE TABLE IF NOT EXISTS public.tiktok_posts_daily (
  video_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  sec_uid TEXT,
  post_date DATE NOT NULL,
  comment_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  digg_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster campaign aggregations
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

-- 4) RLS policies updates for social_metrics
-- Allow users to update their own metrics
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Users can update own metrics'
  ) THEN
    CREATE POLICY "Users can update own metrics" ON public.social_metrics FOR UPDATE
      USING (user_id = auth.uid());
  END IF;
END $$;

-- Allow admins to insert/update all metrics (for admin fetching others' data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Admin can insert all metrics'
  ) THEN
    CREATE POLICY "Admin can insert all metrics" ON public.social_metrics FOR INSERT
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='social_metrics' AND policyname='Admin can update all metrics'
  ) THEN
    CREATE POLICY "Admin can update all metrics" ON public.social_metrics FOR UPDATE
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

-- 5) RPC: get_user_profile
-- Drop first to avoid return type mismatch errors if it already exists
DROP FUNCTION IF EXISTS public.get_user_profile();

CREATE OR REPLACE FUNCTION public.get_user_profile()
RETURNS public.users
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM public.users WHERE id = auth.uid();
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_user_profile() TO authenticated;

COMMIT;
-- Add aggregate metric columns and JSON snapshot to campaign_participants
-- Date: 2025-10-24

BEGIN;

ALTER TABLE public.campaign_participants
  ADD COLUMN IF NOT EXISTS followers bigint,
  ADD COLUMN IF NOT EXISTS views bigint,
  ADD COLUMN IF NOT EXISTS likes bigint,
  ADD COLUMN IF NOT EXISTS comments bigint,
  ADD COLUMN IF NOT EXISTS shares bigint,
  ADD COLUMN IF NOT EXISTS saves bigint,
  ADD COLUMN IF NOT EXISTS posts_total integer,
  ADD COLUMN IF NOT EXISTS sec_uid text,
  ADD COLUMN IF NOT EXISTS metrics_json jsonb,
  ADD COLUMN IF NOT EXISTS last_refreshed timestamptz;

-- Helpful index when summing totals for a campaign
CREATE INDEX IF NOT EXISTS idx_campaign_participants_campaign_totals
  ON public.campaign_participants(campaign_id, tiktok_username);

COMMIT;
-- Patch campaigns functions and constraints
-- Date: 2025-10-24

BEGIN;

-- Ensure uniqueness of participants within the same campaign
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_campaign_participants_campaign_username'
  ) THEN
    CREATE UNIQUE INDEX uq_campaign_participants_campaign_username
      ON public.campaign_participants(campaign_id, tiktok_username);
  END IF;
END $$;

-- Drop old functions if they exist
DROP FUNCTION IF EXISTS public.campaign_series(UUID, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.campaign_participant_totals(UUID, DATE, DATE);

-- Recreate with new names to avoid schema cache issues
CREATE OR REPLACE FUNCTION public.campaign_series_v2(
  campaign UUID,
  start_date DATE,
  end_date DATE,
  p_interval TEXT DEFAULT 'daily'
)
RETURNS TABLE(
  bucket_date DATE,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH usernames AS (
  SELECT LOWER(tiktok_username) AS username
  FROM public.campaign_participants
  WHERE campaign_id = campaign
),
-- Group snapshots by video_id to calculate accrual (delta)
video_snapshots AS (
  SELECT 
    p.video_id,
    p.post_date::date AS d,
    p.play_count::bigint AS views,
    p.digg_count::bigint AS likes,
    p.comment_count::bigint AS comments,
    p.share_count::bigint AS shares,
    p.save_count::bigint AS saves,
    ROW_NUMBER() OVER (PARTITION BY p.video_id ORDER BY p.post_date ASC) AS rn_first,
    ROW_NUMBER() OVER (PARTITION BY p.video_id ORDER BY p.post_date DESC) AS rn_last,
    COUNT(*) OVER (PARTITION BY p.video_id) AS snapshot_count
  FROM public.tiktok_posts_daily p
  JOIN usernames u ON u.username = p.username
  WHERE p.post_date BETWEEN start_date AND end_date
),
-- Calculate accrual per video (last snapshot - first snapshot)
video_accrual AS (
  SELECT 
    video_id,
    d,
    CASE 
      WHEN snapshot_count = 1 THEN views
      WHEN rn_last = 1 THEN views - COALESCE((SELECT views FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_views,
    CASE 
      WHEN snapshot_count = 1 THEN likes
      WHEN rn_last = 1 THEN likes - COALESCE((SELECT likes FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_likes,
    CASE 
      WHEN snapshot_count = 1 THEN comments
      WHEN rn_last = 1 THEN comments - COALESCE((SELECT comments FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_comments,
    CASE 
      WHEN snapshot_count = 1 THEN shares
      WHEN rn_last = 1 THEN shares - COALESCE((SELECT shares FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_shares,
    CASE 
      WHEN snapshot_count = 1 THEN saves
      WHEN rn_last = 1 THEN saves - COALESCE((SELECT saves FROM video_snapshots vs2 WHERE vs2.video_id = video_snapshots.video_id AND vs2.rn_first = 1), 0)
      ELSE 0
    END AS accrual_saves
  FROM video_snapshots
  WHERE rn_last = 1  -- Only take the last snapshot per video to get the date
)
SELECT
  CASE
    WHEN p_interval = 'weekly' THEN date_trunc('week', d)::date
    WHEN p_interval = 'monthly' THEN date_trunc('month', d)::date
    ELSE d
  END AS bucket_date,
  SUM(GREATEST(accrual_views, 0)) AS views,
  SUM(GREATEST(accrual_likes, 0)) AS likes,
  SUM(GREATEST(accrual_comments, 0)) AS comments,
  SUM(GREATEST(accrual_shares, 0)) AS shares,
  SUM(GREATEST(accrual_saves, 0)) AS saves
FROM video_accrual
GROUP BY 1
ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.campaign_participant_totals_v2(
  campaign UUID,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
SELECT p.username,
       SUM(p.play_count)::bigint AS views,
       SUM(p.digg_count)::bigint AS likes,
       SUM(p.comment_count)::bigint AS comments,
       SUM(p.share_count)::bigint AS shares,
       SUM(p.save_count)::bigint AS saves
FROM public.tiktok_posts_daily p
JOIN public.campaign_participants cp ON LOWER(cp.tiktok_username) = p.username
WHERE cp.campaign_id = campaign
  AND p.post_date BETWEEN start_date AND end_date
GROUP BY p.username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_series_v2(UUID, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_participant_totals_v2(UUID, DATE, DATE) TO authenticated;

COMMIT;
-- Employee accounts mapping and helper aggregation
-- Date: 2025-10-24

BEGIN;

-- Mapping table: which employee handles which umum-account
CREATE TABLE IF NOT EXISTS public.employee_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_accounts_pair ON public.employee_accounts(employee_id, account_user_id);

ALTER TABLE public.employee_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_accounts' AND tablename='employee_accounts') THEN
    CREATE POLICY "Admin manage employee_accounts" ON public.employee_accounts FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

-- Helper aggregation for a list of usernames within a date range
CREATE OR REPLACE FUNCTION public.user_totals_in_range(
  usernames TEXT[],
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
SELECT p.username,
       SUM(p.play_count)::bigint AS views,
       SUM(p.digg_count)::bigint AS likes,
       SUM(p.comment_count)::bigint AS comments,
       SUM(p.share_count)::bigint AS shares,
       SUM(p.save_count)::bigint AS saves
FROM public.tiktok_posts_daily p
WHERE p.username = ANY (usernames)
  AND p.post_date BETWEEN start_date AND end_date
GROUP BY p.username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.user_totals_in_range(TEXT[], DATE, DATE) TO authenticated;

COMMIT;
-- Ensure tiktok_posts_daily table and required columns/PK exist
-- Date: 2025-10-24

BEGIN;

-- 1) Create table if missing
CREATE TABLE IF NOT EXISTS public.tiktok_posts_daily (
  video_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  sec_uid TEXT,
  post_date DATE NOT NULL,
  comment_count INTEGER DEFAULT 0,
  play_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  digg_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Ensure columns exist (idempotent)
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS sec_uid TEXT;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS post_date DATE;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS digg_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.tiktok_posts_daily ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3) Ensure PK on video_id exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tiktok_posts_daily'::regclass
      AND contype = 'p'
  ) THEN
    -- Drop duplicate video_id if any before setting PK (optional, skip for safety)
    ALTER TABLE public.tiktok_posts_daily ADD CONSTRAINT tiktok_posts_daily_pkey PRIMARY KEY (video_id);
  END IF;
END $$;

-- 4) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

COMMIT;
-- Ensure save_count column exists on tiktok_posts_daily
-- Date: 2025-10-24

BEGIN;

ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;

COMMIT;
-- Leaderboard function for TikTok metrics
-- Date: 2025-10-24

BEGIN;

-- Drop existing function first because return type changed
DROP FUNCTION IF EXISTS public.leaderboard_tiktok(TEXT, DATE, DATE, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.leaderboard_tiktok(
  metric TEXT,
  start_date DATE,
  end_date DATE,
  top_n INTEGER DEFAULT 15,
  campaign UUID DEFAULT NULL
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  total BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH base AS (
  SELECT LOWER(tp.username) AS username,
         COALESCE(SUM(tp.play_count),0)::bigint AS views,
         COALESCE(SUM(tp.digg_count),0)::bigint AS likes,
         COALESCE(SUM(tp.comment_count),0)::bigint AS comments,
         COALESCE(SUM(tp.share_count),0)::bigint AS shares,
         COALESCE(SUM(tp.save_count),0)::bigint AS saves,
         (COALESCE(SUM(tp.play_count),0)
        + COALESCE(SUM(tp.digg_count),0)
        + COALESCE(SUM(tp.comment_count),0)
        + COALESCE(SUM(tp.share_count),0)
        + COALESCE(SUM(tp.save_count),0))::bigint AS total
  FROM public.tiktok_posts_daily tp
  JOIN public.users u
    ON LOWER(u.tiktok_username) = LOWER(tp.username)
   AND u.role = 'umum'
  WHERE tp.post_date BETWEEN start_date AND end_date
  GROUP BY 1
), filtered AS (
  SELECT b.*
  FROM base b
  WHERE campaign IS NULL
     OR EXISTS (
       SELECT 1 FROM public.campaign_participants cp
       WHERE cp.campaign_id = campaign
         AND LOWER(cp.tiktok_username) = b.username
     )
)
SELECT *
FROM filtered
ORDER BY CASE
           WHEN metric = 'likes' THEN likes
           WHEN metric = 'comments' THEN comments
           WHEN metric = 'shares' THEN shares
           WHEN metric = 'saves' THEN saves
           WHEN metric = 'views' THEN views
           ELSE total -- default or 'total'
         END DESC NULLS LAST
LIMIT top_n;
$$;

GRANT EXECUTE ON FUNCTION public.leaderboard_tiktok(TEXT, DATE, DATE, INTEGER, UUID) TO authenticated;

COMMIT;
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
-- Add cached TikTok secUid to users table for fewer API calls
-- Date: 2025-10-24

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tiktok_sec_uid TEXT;

-- Optional helpful index
CREATE INDEX IF NOT EXISTS idx_users_tiktok_sec_uid ON public.users(tiktok_sec_uid);

COMMIT;
-- Campaign prizes for leaderboard top 3
-- Date: 2025-10-25

BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
  first_prize BIGINT NOT NULL DEFAULT 0,
  second_prize BIGINT NOT NULL DEFAULT 0,
  third_prize BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.campaign_prizes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='campaign_prizes' AND policyname='Admin manage campaign_prizes'
  ) THEN
    CREATE POLICY "Admin manage campaign_prizes" ON public.campaign_prizes FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

-- Helpful index for quick lookup by campaign
CREATE INDEX IF NOT EXISTS idx_campaign_prizes_campaign ON public.campaign_prizes(campaign_id);

COMMIT;
-- Ensure unique username generation and robust profile sync on new auth users
-- Date: 2025-11-04

BEGIN;

-- Helper to generate a unique username based on a base string
CREATE OR REPLACE FUNCTION public.gen_unique_username(p_base TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  base TEXT := regexp_replace(lower(coalesce(p_base,'user')),'[^a-z0-9_\.\-]','', 'g');
  candidate TEXT := left(base, 24);
  tries INT := 0;
BEGIN
  IF candidate = '' THEN candidate := 'user'; END IF;
  LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users u WHERE u.username = candidate);
    tries := tries + 1;
    candidate := left(base, 20) || '-' || substr(md5(random()::text), 1, 4);
    IF tries > 10 THEN
      candidate := left(base, 16) || '-' || substr(md5(now()::text), 1, 8);
      EXIT;
    END IF;
  END LOOP;
  RETURN candidate;
END;
$$;

-- Trigger to insert/sync a profile row when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_email TEXT := NEW.email;
  v_username TEXT := NULL;
BEGIN
  -- Derive a unique username from email prefix
  IF v_email IS NOT NULL THEN
    v_username := public.gen_unique_username(split_part(v_email,'@',1));
  ELSE
    v_username := public.gen_unique_username('user');
  END IF;

  INSERT INTO public.users (id, email, username, role)
  VALUES (NEW.id, v_email, v_username, 'umum')
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
  ;

  RETURN NEW;
END;
$$;

-- Drop existing triggers if present, then create ours
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    DROP TRIGGER on_auth_user_created ON auth.users;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    DROP TRIGGER on_auth_user_created ON auth.users;
  END IF;
END$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

COMMIT;
-- Daily/weekly/monthly series for a subset of usernames within a date window
create or replace function campaign_series_usernames(
  start_date date,
  end_date date,
  usernames text[],
  p_interval text default 'daily'
)
returns table (
  bucket_date date,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint
) language sql stable as $$
  with base as (
    select
      case
        when lower(p_interval) = 'monthly' then date_trunc('month', t.post_date)::date
        when lower(p_interval) = 'weekly' then date_trunc('week', t.post_date)::date
        else t.post_date
      end as bucket_date,
      coalesce(t.play_count,0)::bigint as views,
      coalesce(t.digg_count,0)::bigint as likes,
      coalesce(t.comment_count,0)::bigint as comments,
      coalesce(t.share_count,0)::bigint as shares,
      coalesce(t.save_count,0)::bigint as saves
    from tiktok_posts_daily t
    where t.post_date >= start_date
      and t.post_date <= end_date
      and t.username = any(usernames)
  )
  select bucket_date,
         sum(views) as views,
         sum(likes) as likes,
         sum(comments) as comments,
         sum(shares) as shares,
         sum(saves) as saves
  from base
  group by bucket_date
  order by bucket_date asc;
$$;
-- Create mapping table to assign employees (users) to groups (campaigns)
-- Date: 2025-11-20

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_groups_pair ON public.employee_groups(employee_id, campaign_id);

ALTER TABLE public.employee_groups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_groups' AND tablename='employee_groups') THEN
    CREATE POLICY "Admin manage employee_groups" ON public.employee_groups FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;
-- Map employees to specific campaign participants (by tiktok_username)
create table if not exists employee_participants (
  employee_id uuid not null references users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  tiktok_username text not null,
  created_at timestamptz not null default now(),
  primary key (employee_id, campaign_id, tiktok_username)
);

create index if not exists employee_participants_campaign_idx on employee_participants(campaign_id);
create index if not exists employee_participants_username_idx on employee_participants(tiktok_username);
-- Enforce a username in one campaign can only be assigned to one employee
create unique index if not exists employee_participants_unique_campaign_username
  on employee_participants(campaign_id, tiktok_username);
-- Allow multiple TikTok usernames per user
create table if not exists user_tiktok_usernames (
  user_id uuid not null references users(id) on delete cascade,
  tiktok_username text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tiktok_username)
);
create index if not exists user_tiktok_usernames_username_idx on user_tiktok_usernames(tiktok_username);
-- Align tiktok_posts_daily schema with backend expectations
-- Ensures primary key on video_id and required metric columns exist.

BEGIN;

-- Add required columns if missing
ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS video_id TEXT,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS sec_uid TEXT,
  ADD COLUMN IF NOT EXISTS post_date DATE,
  ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS digg_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Drop existing PK and/or id column if present, then set PK on video_id
DO $$
DECLARE
  pk_name text;
  has_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tiktok_posts_daily' AND column_name='id'
  ) INTO has_id;

  SELECT conname INTO pk_name FROM pg_constraint
  WHERE conrelid='public.tiktok_posts_daily'::regclass AND contype='p' LIMIT 1;

  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tiktok_posts_daily DROP CONSTRAINT %I', pk_name);
  END IF;

  IF has_id THEN
    ALTER TABLE public.tiktok_posts_daily DROP COLUMN IF EXISTS id;
  END IF;

  -- Ensure PK on video_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.tiktok_posts_daily'::regclass AND contype='p'
  ) THEN
    ALTER TABLE public.tiktok_posts_daily ADD CONSTRAINT tiktok_posts_daily_pkey PRIMARY KEY (video_id);
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username ON public.tiktok_posts_daily(username);
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_post_date ON public.tiktok_posts_daily(post_date);

COMMIT;
-- Groups-based schema for TikTok metrics (simpler than campaigns)
-- Date: 2025-11-21
-- This migration introduces:
-- - groups: daftar Group (A, B, dll)
-- - group_members: karyawan yang tergabung dalam Group
-- - group_participants: daftar username TikTok per Group
-- - group_participant_snapshots: snapshot metrik agregat per username per Group (followers, views, likes, comments, shares, saves, posts_total)
-- - view group_leaderboard: memudahkan query leaderboard per Group
-- - helper function upsert_group_participant_snapshot: untuk menyimpan hasil refresh

BEGIN;

-- 1) Groups
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Group members (karyawan di Group) - optional, bisa kosong
CREATE TABLE IF NOT EXISTS public.group_members (
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, employee_id)
);

-- 3) Group participants (username TikTok per Group)
CREATE TABLE IF NOT EXISTS public.group_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, tiktok_username)
);
CREATE INDEX IF NOT EXISTS idx_group_participants_group ON public.group_participants(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_username ON public.group_participants(tiktok_username);

-- 4) Snapshot metrik per username per Group (sumber utama untuk frontend)
CREATE TABLE IF NOT EXISTS public.group_participant_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  followers BIGINT DEFAULT 0,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  saves BIGINT DEFAULT 0,
  posts_total INTEGER DEFAULT 0,
  metrics_json JSONB,
  last_refreshed TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, tiktok_username)
);
CREATE INDEX IF NOT EXISTS idx_group_participant_snapshots_group ON public.group_participant_snapshots(group_id);
CREATE INDEX IF NOT EXISTS idx_group_participant_snapshots_username ON public.group_participant_snapshots(tiktok_username);

-- 5) View untuk leaderboard per Group
CREATE OR REPLACE VIEW public.group_leaderboard AS
SELECT
  gps.group_id,
  gps.tiktok_username,
  gps.followers,
  gps.views,
  gps.likes,
  gps.comments,
  gps.shares,
  gps.saves,
  gps.posts_total,
  (COALESCE(gps.views,0)+COALESCE(gps.likes,0)+COALESCE(gps.comments,0)+COALESCE(gps.shares,0)+COALESCE(gps.saves,0)) AS total,
  gps.last_refreshed
FROM public.group_participant_snapshots gps;

-- 6) Helper function untuk upsert snapshot dengan mudah dari backend
CREATE OR REPLACE FUNCTION public.upsert_group_participant_snapshot(
  p_group_id UUID,
  p_tiktok_username TEXT,
  p_followers BIGINT,
  p_views BIGINT,
  p_likes BIGINT,
  p_comments BIGINT,
  p_shares BIGINT,
  p_saves BIGINT,
  p_posts_total INTEGER,
  p_metrics_json JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO public.group_participant_snapshots (
    group_id, tiktok_username, followers, views, likes, comments, shares, saves, posts_total, metrics_json, last_refreshed
  ) VALUES (
    p_group_id, LOWER(REGEXP_REPLACE(p_tiktok_username, '^@', '')), p_followers, p_views, p_likes, p_comments, p_shares, p_saves, p_posts_total, p_metrics_json, NOW()
  )
  ON CONFLICT (group_id, tiktok_username) DO UPDATE SET
    followers = EXCLUDED.followers,
    views = EXCLUDED.views,
    likes = EXCLUDED.likes,
    comments = EXCLUDED.comments,
    shares = EXCLUDED.shares,
    saves = EXCLUDED.saves,
    posts_total = EXCLUDED.posts_total,
    metrics_json = EXCLUDED.metrics_json,
    last_refreshed = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7) RLS (optional): batasi akses, admin full
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_participant_snapshots ENABLE ROW LEVEL SECURITY;

-- Admin manage all
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage groups' AND tablename='groups') THEN
    CREATE POLICY "Admin manage groups" ON public.groups FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage group_members' AND tablename='group_members') THEN
    CREATE POLICY "Admin manage group_members" ON public.group_members FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage group_participants' AND tablename='group_participants') THEN
    CREATE POLICY "Admin manage group_participants" ON public.group_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage group_participant_snapshots' AND tablename='group_participant_snapshots') THEN
    CREATE POLICY "Admin manage group_participant_snapshots" ON public.group_participant_snapshots FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

-- 8) OPTIONAL CLEANUP (hapus tabel yang tidak dipakai) - HATI-HATI! Un-comment jika yakin.
-- DROP TABLE IF EXISTS public.campaign_prizes CASCADE;
-- DROP TABLE IF EXISTS public.employee_participants CASCADE;
-- DROP TABLE IF EXISTS public.employee_groups CASCADE;
-- DROP TABLE IF EXISTS public.campaign_participants CASCADE;
-- DROP TABLE IF EXISTS public.campaigns CASCADE;
-- DROP FUNCTION IF EXISTS public.campaign_series_v2 CASCADE;
-- DROP FUNCTION IF EXISTS public.campaign_participant_totals_v2 CASCADE;

COMMIT;
-- Campaign-level Instagram participants (usernames independent from TikTok)
-- Date: 2025-11-24

BEGIN;

CREATE TABLE IF NOT EXISTS public.campaign_instagram_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_ig_participant ON public.campaign_instagram_participants(campaign_id, instagram_username);
CREATE INDEX IF NOT EXISTS idx_campaign_ig_participants_campaign ON public.campaign_instagram_participants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_ig_participants_username ON public.campaign_instagram_participants(instagram_username);

ALTER TABLE public.campaign_instagram_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage campaign_instagram_participants' AND tablename='campaign_instagram_participants') THEN
    CREATE POLICY "Admin manage campaign_instagram_participants" ON public.campaign_instagram_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;
-- Add snapshot columns to campaign_instagram_participants to store IG summary per campaign
-- Date: 2025-11-24

BEGIN;

ALTER TABLE public.campaign_instagram_participants
  ADD COLUMN IF NOT EXISTS followers BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_json JSONB,
  ADD COLUMN IF NOT EXISTS last_refreshed TIMESTAMPTZ;

COMMIT;
-- Map employees to Instagram usernames per campaign
-- Date: 2025-11-24

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_instagram_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, campaign_id, instagram_username)
);

CREATE INDEX IF NOT EXISTS employee_instagram_participants_campaign_idx ON public.employee_instagram_participants(campaign_id);
CREATE INDEX IF NOT EXISTS employee_instagram_participants_username_idx ON public.employee_instagram_participants(instagram_username);

ALTER TABLE public.employee_instagram_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_instagram_participants' AND tablename='employee_instagram_participants') THEN
    CREATE POLICY "Admin manage employee_instagram_participants" ON public.employee_instagram_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;
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
-- Cache table for mapping IG username -> numeric user_id (pk)
-- Safe to create; used by API routes and edge function
-- Date: 2025-11-24

BEGIN;

CREATE TABLE IF NOT EXISTS public.instagram_user_ids (
  instagram_username TEXT PRIMARY KEY,
  instagram_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.instagram_user_ids ENABLE ROW LEVEL SECURITY;

COMMIT;
-- Allow social_metrics to store Instagram platform in addition to TikTok
-- Date: 2025-11-24

BEGIN;

-- Drop old TikTok-only check constraints if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_tiktok_chk'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_tiktok_chk;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_schema='public' AND table_name='social_metrics' AND constraint_name='social_metrics_platform_check'
  ) THEN
    ALTER TABLE public.social_metrics DROP CONSTRAINT social_metrics_platform_check;
  END IF;
END $$;

-- Add new check constraint to allow both tiktok and instagram
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_metrics_platform_allowed_chk'
  ) THEN
    ALTER TABLE public.social_metrics
      ADD CONSTRAINT social_metrics_platform_allowed_chk CHECK (platform IN ('tiktok','instagram'));
  END IF;
END $$;

-- Ensure required columns exist (idempotent safeguard)
ALTER TABLE public.social_metrics
  ADD COLUMN IF NOT EXISTS followers INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saves INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ;

-- Unique index on (user_id, platform) for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_social_metrics_user_platform'
  ) THEN
    CREATE UNIQUE INDEX idx_social_metrics_user_platform ON public.social_metrics(user_id, platform);
  END IF;
END $$;

COMMIT;
-- Add instagram primary username and mapping table for multiple IG usernames per user
-- Date: 2025-11-24

BEGIN;

-- Re-introduce instagram_username on users for primary handle (safe if exists)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Mapping table: multiple instagram usernames per user
CREATE TABLE IF NOT EXISTS public.user_instagram_usernames (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  instagram_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, instagram_username)
);

CREATE INDEX IF NOT EXISTS user_instagram_usernames_username_idx
  ON public.user_instagram_usernames(instagram_username);

COMMIT;
-- Migration: create table to cache Instagram username -> user_id mappings
create table if not exists instagram_user_ids (
  instagram_username text primary key,
  instagram_user_id text not null,
  created_at timestamptz default now()
);

-- index for quick lookup
create index if not exists instagram_user_ids_username_idx on instagram_user_ids(instagram_username);
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
-- Add required_hashtags column to campaigns table for hashtag-based filtering
-- Date: 2025-12-03

BEGIN;

-- Add required_hashtags column (text array or JSONB for multiple hashtags)
ALTER TABLE public.campaigns 
ADD COLUMN IF NOT EXISTS required_hashtags TEXT[];

-- Add comment for documentation
COMMENT ON COLUMN public.campaigns.required_hashtags IS 
'Array of required hashtags (e.g., ["#SULMO", "#TRADING"]). Videos must contain at least one of these hashtags to be counted in campaign metrics. Case-insensitive matching.';

-- Create index for faster hashtag filtering
CREATE INDEX IF NOT EXISTS idx_campaigns_required_hashtags 
ON public.campaigns USING GIN (required_hashtags) 
WHERE required_hashtags IS NOT NULL;

COMMIT;
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
-- Add code column to instagram_posts_daily for Instagram shortcode (used in reel URLs)
-- Date: 2025-12-03

BEGIN;

-- Add code column (nullable, will be populated gradually)
ALTER TABLE public.instagram_posts_daily 
ADD COLUMN IF NOT EXISTS code TEXT;

-- Create index for faster lookups by code
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_code 
ON public.instagram_posts_daily(code) WHERE code IS NOT NULL;

-- Backfill code from id where they match (shortcode format)
-- Skip if id looks like numeric (those are media IDs, not shortcodes)
UPDATE public.instagram_posts_daily 
SET code = id 
WHERE code IS NULL 
  AND id ~ '^[A-Za-z0-9_-]{11}$'; -- Shortcode format (11 chars alphanumeric)

COMMIT;
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
-- Add title and caption columns for hashtag filtering
-- Date: 2025-12-04

BEGIN;

-- Add title column to tiktok_posts_daily
ALTER TABLE public.tiktok_posts_daily 
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Add caption column to instagram_posts_daily
ALTER TABLE public.instagram_posts_daily 
  ADD COLUMN IF NOT EXISTS caption TEXT;

-- Create GIN indexes for faster text search (multi-language: simple config works for both EN & ID)
-- Using 'simple' config to support both English and Indonesian hashtags
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_title_gin 
  ON public.tiktok_posts_daily USING gin(to_tsvector('simple', COALESCE(title, '')));

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_caption_gin 
  ON public.instagram_posts_daily USING gin(to_tsvector('simple', COALESCE(caption, '')));

COMMIT;
-- Employee Profile Enhancements
-- Add profile picture support and create view for total metrics across all platforms
-- Date: 2025-12-04

BEGIN;

-- 1. Add profile_picture_url to users table
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- 2. Create materialized view for employee total metrics (TikTok + Instagram combined)
DROP MATERIALIZED VIEW IF EXISTS public.employee_total_metrics CASCADE;
CREATE MATERIALIZED VIEW public.employee_total_metrics AS
WITH tiktok_totals AS (
  -- Aggregate TikTok metrics from tiktok_posts_daily
  SELECT 
    etp.employee_id as user_id,
    SUM(COALESCE(tpd.play_count, 0)) as tiktok_views,
    SUM(COALESCE(tpd.digg_count, 0)) as tiktok_likes,
    SUM(COALESCE(tpd.comment_count, 0)) as tiktok_comments,
    SUM(COALESCE(tpd.share_count, 0)) as tiktok_shares,
    0 as tiktok_followers,
    MAX(tpd.created_at) as tiktok_last_updated
  FROM public.employee_participants etp
  JOIN public.tiktok_posts_daily tpd 
    ON LOWER(etp.tiktok_username) = LOWER(tpd.username)
  GROUP BY etp.employee_id
),
instagram_totals AS (
  -- Aggregate Instagram metrics from instagram_posts_daily
  SELECT
    eip.employee_id as user_id,
    SUM(COALESCE(ipd.play_count, 0)) as instagram_views,
    SUM(COALESCE(ipd.like_count, 0)) as instagram_likes,
    SUM(COALESCE(ipd.comment_count, 0)) as instagram_comments,
    0 as instagram_shares,
    0 as instagram_followers,
    MAX(ipd.created_at) as instagram_last_updated
  FROM public.employee_instagram_participants eip
  JOIN public.instagram_posts_daily ipd 
    ON LOWER(eip.instagram_username) = LOWER(ipd.username)
  GROUP BY eip.employee_id
),
employee_usernames AS (
  -- Get employee TikTok usernames (from multiple sources)
  SELECT DISTINCT
    u.id as user_id,
    COALESCE(
      utu.tiktok_username,
      u.tiktok_username
    ) as tiktok_username
  FROM public.users u
  LEFT JOIN public.user_tiktok_usernames utu ON u.id = utu.user_id
  WHERE u.role = 'karyawan'
),
employee_ig_usernames AS (
  -- Get employee Instagram usernames
  SELECT DISTINCT
    u.id as user_id,
    COALESCE(
      uiu.instagram_username,
      u.instagram_username
    ) as instagram_username
  FROM public.users u
  LEFT JOIN public.user_instagram_usernames uiu ON u.id = uiu.user_id
  WHERE u.role = 'karyawan'
)
SELECT
  u.id as employee_id,
  u.full_name,
  u.username,
  u.email,
  u.profile_picture_url,
  -- TikTok totals
  COALESCE(tt.tiktok_views, 0) as total_tiktok_views,
  COALESCE(tt.tiktok_likes, 0) as total_tiktok_likes,
  COALESCE(tt.tiktok_comments, 0) as total_tiktok_comments,
  COALESCE(tt.tiktok_shares, 0) as total_tiktok_shares,
  COALESCE(tt.tiktok_followers, 0) as total_tiktok_followers,
  -- Instagram totals
  COALESCE(it.instagram_views, 0) as total_instagram_views,
  COALESCE(it.instagram_likes, 0) as total_instagram_likes,
  COALESCE(it.instagram_comments, 0) as total_instagram_comments,
  COALESCE(it.instagram_shares, 0) as total_instagram_shares,
  COALESCE(it.instagram_followers, 0) as total_instagram_followers,
  -- Combined totals
  COALESCE(tt.tiktok_views, 0) + COALESCE(it.instagram_views, 0) as total_views,
  COALESCE(tt.tiktok_likes, 0) + COALESCE(it.instagram_likes, 0) as total_likes,
  COALESCE(tt.tiktok_comments, 0) + COALESCE(it.instagram_comments, 0) as total_comments,
  COALESCE(tt.tiktok_shares, 0) + COALESCE(it.instagram_shares, 0) as total_shares,
  -- Usernames
  (SELECT array_agg(DISTINCT tiktok_username) FROM employee_usernames eu WHERE eu.user_id = u.id) as tiktok_usernames,
  (SELECT array_agg(DISTINCT instagram_username) FROM employee_ig_usernames eiu WHERE eiu.user_id = u.id) as instagram_usernames,
  -- Last updated timestamps
  tt.tiktok_last_updated,
  it.instagram_last_updated,
  GREATEST(tt.tiktok_last_updated, it.instagram_last_updated) as last_updated
FROM public.users u
LEFT JOIN tiktok_totals tt ON u.id = tt.user_id
LEFT JOIN instagram_totals it ON u.id = it.user_id
WHERE u.role = 'karyawan';

-- Create index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_total_metrics_employee_id 
  ON public.employee_total_metrics(employee_id);

-- 3. Create function to refresh the materialized view
CREATE OR REPLACE FUNCTION public.refresh_employee_total_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.employee_total_metrics;
END;
$$;

-- 4. Grant permissions
GRANT SELECT ON public.employee_total_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_employee_total_metrics() TO authenticated;

-- 5. Initial refresh
REFRESH MATERIALIZED VIEW public.employee_total_metrics;

COMMIT;
-- Supabase Storage setup for profile pictures
-- Create bucket and set RLS policies
-- Date: 2025-12-04

BEGIN;

-- 1. Create storage bucket 'avatars' (if not exists via UI, this ensures policies)
-- Note: Bucket creation is typically done via Supabase UI, but policies must be in SQL

-- 2. Enable RLS on storage.objects (should already be enabled by default)
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Allow authenticated users to upload to their own folder in avatars bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can upload own profile pictures'
  ) THEN
    CREATE POLICY "Users can upload own profile pictures"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

-- 4. Policy: Allow authenticated users to read all avatars (public bucket)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Anyone can view avatars'
  ) THEN
    CREATE POLICY "Anyone can view avatars"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'avatars');
  END IF;
END $$;

-- 5. Policy: Allow users to update their own profile pictures
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can update own profile pictures'
  ) THEN
    CREATE POLICY "Users can update own profile pictures"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    )
    WITH CHECK (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

-- 6. Policy: Allow users to delete their own old profile pictures
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can delete own profile pictures'
  ) THEN
    CREATE POLICY "Users can delete own profile pictures"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

COMMIT;
-- Add RLS policy to allow users to update their own profile_picture_url
-- Date: 2025-12-05

BEGIN;

-- Drop existing policy if exists and recreate
DO $$ 
BEGIN
  -- Check if policy exists and drop it
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'users' 
    AND policyname = 'Users can update own profile picture'
  ) THEN
    DROP POLICY "Users can update own profile picture" ON public.users;
  END IF;
END $$;

-- Create policy to allow users to update their own profile_picture_url
CREATE POLICY "Users can update own profile picture"
ON public.users
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Also ensure users can select their own data
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = 'users' 
    AND policyname = 'Users can view own profile'
  ) THEN
    CREATE POLICY "Users can view own profile"
    ON public.users
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);
  END IF;
END $$;

COMMIT;

-- Verify policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'users'
ORDER BY policyname;
-- Fix campaign_participant_totals_v2 to use ACCRUAL (delta) not SUM
-- Date: 2025-12-06
-- Issue: Function was summing all snapshots instead of calculating last - first per video
-- Result: Inflated metrics (if 5 snapshots, counts 5x the actual views)

BEGIN;

DROP FUNCTION IF EXISTS public.campaign_participant_totals_v2(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION public.campaign_participant_totals_v2(
  campaign UUID,
  start_date DATE,
  end_date DATE
)
RETURNS TABLE(
  username TEXT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH usernames AS (
  SELECT LOWER(tiktok_username) AS username
  FROM public.campaign_participants
  WHERE campaign_id = campaign
),
-- Group snapshots by video_id to calculate accrual (delta)
video_snapshots AS (
  SELECT 
    p.video_id,
    p.username,
    p.play_count::bigint AS views,
    p.digg_count::bigint AS likes,
    p.comment_count::bigint AS comments,
    p.share_count::bigint AS shares,
    p.save_count::bigint AS saves,
    ROW_NUMBER() OVER (PARTITION BY p.video_id ORDER BY p.post_date ASC) AS rn_first,
    ROW_NUMBER() OVER (PARTITION BY p.video_id ORDER BY p.post_date DESC) AS rn_last,
    COUNT(*) OVER (PARTITION BY p.video_id) AS snapshot_count
  FROM public.tiktok_posts_daily p
  JOIN usernames u ON u.username = p.username
  WHERE p.post_date BETWEEN start_date AND end_date
),
-- Get first and last snapshot per video
video_ranges AS (
  SELECT 
    video_id,
    username,
    MAX(CASE WHEN rn_first = 1 THEN views ELSE 0 END) AS first_views,
    MAX(CASE WHEN rn_first = 1 THEN likes ELSE 0 END) AS first_likes,
    MAX(CASE WHEN rn_first = 1 THEN comments ELSE 0 END) AS first_comments,
    MAX(CASE WHEN rn_first = 1 THEN shares ELSE 0 END) AS first_shares,
    MAX(CASE WHEN rn_first = 1 THEN saves ELSE 0 END) AS first_saves,
    MAX(CASE WHEN rn_last = 1 THEN views ELSE 0 END) AS last_views,
    MAX(CASE WHEN rn_last = 1 THEN likes ELSE 0 END) AS last_likes,
    MAX(CASE WHEN rn_last = 1 THEN comments ELSE 0 END) AS last_comments,
    MAX(CASE WHEN rn_last = 1 THEN shares ELSE 0 END) AS last_shares,
    MAX(CASE WHEN rn_last = 1 THEN saves ELSE 0 END) AS last_saves,
    MAX(snapshot_count) AS snapshot_count
  FROM video_snapshots
  GROUP BY video_id, username
),
-- Calculate accrual per video (last - first, or just value if single snapshot)
video_accrual AS (
  SELECT 
    username,
    CASE 
      WHEN snapshot_count = 1 THEN last_views
      ELSE GREATEST(last_views - first_views, 0)
    END AS accrual_views,
    CASE 
      WHEN snapshot_count = 1 THEN last_likes
      ELSE GREATEST(last_likes - first_likes, 0)
    END AS accrual_likes,
    CASE 
      WHEN snapshot_count = 1 THEN last_comments
      ELSE GREATEST(last_comments - first_comments, 0)
    END AS accrual_comments,
    CASE 
      WHEN snapshot_count = 1 THEN last_shares
      ELSE GREATEST(last_shares - first_shares, 0)
    END AS accrual_shares,
    CASE 
      WHEN snapshot_count = 1 THEN last_saves
      ELSE GREATEST(last_saves - first_saves, 0)
    END AS accrual_saves
  FROM video_ranges
)
SELECT
  username,
  SUM(accrual_views)::bigint AS views,
  SUM(accrual_likes)::bigint AS likes,
  SUM(accrual_comments)::bigint AS comments,
  SUM(accrual_shares)::bigint AS shares,
  SUM(accrual_saves)::bigint AS saves
FROM video_accrual
GROUP BY username
ORDER BY views DESC;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_participant_totals_v2(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.campaign_participant_totals_v2 IS 'Returns campaign participant totals using ACCRUAL method (last snapshot - first snapshot per video), not sum of all snapshots. This prevents inflated metrics when videos are tracked multiple times.';

COMMIT;
-- CRITICAL FIX: Delete auto-created junk accounts with NULL usernames
-- Date: 2025-12-06
--
-- Bug: fetch-ig and fetch-metrics auto-created users without proper usernames
-- These are junk accounts that should be deleted
--
-- Solution: Delete users with NULL username (except admins)

BEGIN;

-- Delete users with NULL username (these are auto-created junk accounts)
DELETE FROM public.users
WHERE username IS NULL
  AND role NOT IN ('admin', 'super_admin'); -- Keep admin accounts safe

COMMIT;

-- Verification query - run after migration to check results
-- SELECT 
--   role,
--   COUNT(*) as total,
--   COUNT(username) as with_username,
--   COUNT(*) FILTER (WHERE username IS NULL) as null_username
-- FROM public.users
-- GROUP BY role
-- ORDER BY role;

-- CRITICAL FIX: Correct Post Date vs Accrual Mode Logic
-- Date: 2025-12-06
-- 
-- POST DATE MODE: Shows metrics from videos POSTED within date range
--   - Video posted Aug 1 with 5M views → counts ALL 5M if posted in range
--   - Video posted before range → does NOT count
--
-- ACCRUAL MODE: Shows DAILY INCREMENTS summed within date range (regardless of post date)
--   - Day 1: Account has +1M views → count +1M
--   - Day 2: Account has +500K views → count +500K
--   - Day 3: Account has +200M views (viral!) → count +200M
--   - Total accrual: 1M + 500K + 200M = 201.5M
--   - Works by comparing CONSECUTIVE daily snapshots (today - yesterday)

-- ============================================================================
-- 1. FIX: campaign_participant_totals_v2 (TikTok)
-- ============================================================================
CREATE OR REPLACE FUNCTION campaign_participant_totals_v2(
  p_campaign_id TEXT,
  p_start_date TEXT,
  p_end_date TEXT,
  p_mode TEXT DEFAULT 'post_date'
)
RETURNS TABLE (
  tiktok_username TEXT,
  total_views BIGINT,
  total_likes BIGINT,
  total_comments BIGINT,
  total_shares BIGINT,
  total_saves BIGINT,
  video_count BIGINT
) AS $$
BEGIN
  IF p_mode = 'accrual' THEN
    -- ACCRUAL MODE: Sum DAILY INCREMENTS (today - yesterday) for each video
    -- This shows the daily growth rate, not total delta
    RETURN QUERY
    WITH daily_increments AS (
      SELECT 
        s.tiktok_username,
        s.aweme_id,
        s.snapshot_date,
        s.play_count,
        s.digg_count,
        s.comment_count,
        s.share_count,
        s.save_count,
        -- Get previous day's values using LAG
        LAG(s.play_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_views,
        LAG(s.digg_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_likes,
        LAG(s.comment_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_comments,
        LAG(s.share_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_shares,
        LAG(s.save_count) OVER (PARTITION BY s.tiktok_username, s.aweme_id ORDER BY s.snapshot_date) as prev_saves
      FROM campaign_participants_snapshot s
      WHERE s.campaign_id = p_campaign_id
        AND s.snapshot_date >= p_start_date::date
        AND s.snapshot_date <= p_end_date::date
    )
    SELECT 
      di.tiktok_username,
      -- Sum daily increments (only count positive growth)
      SUM(GREATEST(0, di.play_count - COALESCE(di.prev_views, 0)))::bigint as total_views,
      SUM(GREATEST(0, di.digg_count - COALESCE(di.prev_likes, 0)))::bigint as total_likes,
      SUM(GREATEST(0, di.comment_count - COALESCE(di.prev_comments, 0)))::bigint as total_comments,
      SUM(GREATEST(0, di.share_count - COALESCE(di.prev_shares, 0)))::bigint as total_shares,
      SUM(GREATEST(0, di.save_count - COALESCE(di.prev_saves, 0)))::bigint as total_saves,
      COUNT(DISTINCT di.aweme_id)::bigint as video_count
    FROM daily_increments di
    WHERE di.prev_views IS NOT NULL -- Skip first snapshot (no previous to compare)
    GROUP BY di.tiktok_username;
    
  ELSE
    -- POST DATE MODE: Sum metrics from videos POSTED within date range
    RETURN QUERY
    SELECT 
      s.tiktok_username,
      SUM(s.play_count)::bigint as total_views,
      SUM(s.digg_count)::bigint as total_likes,
      SUM(s.comment_count)::bigint as total_comments,
      SUM(s.share_count)::bigint as total_shares,
      SUM(s.save_count)::bigint as total_saves,
      COUNT(DISTINCT s.aweme_id)::bigint as video_count
    FROM campaign_participants_snapshot s
    WHERE s.campaign_id = p_campaign_id
      AND s.create_time::date >= p_start_date::date
      AND s.create_time::date <= p_end_date::date
      -- Use only the LATEST snapshot for each video to get current totals
      AND s.snapshot_date = (
        SELECT MAX(s2.snapshot_date)
        FROM campaign_participants_snapshot s2
        WHERE s2.campaign_id = s.campaign_id
          AND s2.tiktok_username = s.tiktok_username
          AND s2.aweme_id = s.aweme_id
      )
    GROUP BY s.tiktok_username;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. FIX: campaign_instagram_participant_totals_v2 (Instagram)
-- ============================================================================
CREATE OR REPLACE FUNCTION campaign_instagram_participant_totals_v2(
  p_campaign_id TEXT,
  p_start_date TEXT,
  p_end_date TEXT,
  p_mode TEXT DEFAULT 'post_date'
)
RETURNS TABLE (
  instagram_username TEXT,
  total_views BIGINT,
  total_likes BIGINT,
  total_comments BIGINT,
  post_count BIGINT
) AS $$
BEGIN
  IF p_mode = 'accrual' THEN
    -- ACCRUAL MODE: Sum DAILY INCREMENTS (today - yesterday) for each post
    -- This shows the daily growth rate, not total delta
    RETURN QUERY
    WITH daily_increments AS (
      SELECT 
        s.instagram_username,
        s.shortcode,
        s.snapshot_date,
        s.play_count,
        s.like_count,
        s.comment_count,
        -- Get previous day's values using LAG
        LAG(s.play_count) OVER (PARTITION BY s.instagram_username, s.shortcode ORDER BY s.snapshot_date) as prev_views,
        LAG(s.like_count) OVER (PARTITION BY s.instagram_username, s.shortcode ORDER BY s.snapshot_date) as prev_likes,
        LAG(s.comment_count) OVER (PARTITION BY s.instagram_username, s.shortcode ORDER BY s.snapshot_date) as prev_comments
      FROM campaign_instagram_participants_snapshot s
      WHERE s.campaign_id = p_campaign_id
        AND s.snapshot_date >= p_start_date::date
        AND s.snapshot_date <= p_end_date::date
    )
    SELECT 
      di.instagram_username,
      -- Sum daily increments (only count positive growth)
      SUM(GREATEST(0, di.play_count - COALESCE(di.prev_views, 0)))::bigint as total_views,
      SUM(GREATEST(0, di.like_count - COALESCE(di.prev_likes, 0)))::bigint as total_likes,
      SUM(GREATEST(0, di.comment_count - COALESCE(di.prev_comments, 0)))::bigint as total_comments,
      COUNT(DISTINCT di.shortcode)::bigint as post_count
    FROM daily_increments di
    WHERE di.prev_views IS NOT NULL -- Skip first snapshot (no previous to compare)
    GROUP BY di.instagram_username;
    
  ELSE
    -- POST DATE MODE: Sum metrics from posts POSTED within date range
    RETURN QUERY
    SELECT 
      s.instagram_username,
      SUM(s.play_count)::bigint as total_views,
      SUM(s.like_count)::bigint as total_likes,
      SUM(s.comment_count)::bigint as total_comments,
      COUNT(DISTINCT s.shortcode)::bigint as post_count
    FROM campaign_instagram_participants_snapshot s
    WHERE s.campaign_id = p_campaign_id
      AND s.taken_at::date >= p_start_date::date
      AND s.taken_at::date <= p_end_date::date
      -- Use only the LATEST snapshot for each post to get current totals
      AND s.snapshot_date = (
        SELECT MAX(s2.snapshot_date)
        FROM campaign_instagram_participants_snapshot s2
        WHERE s2.campaign_id = s.campaign_id
          AND s2.instagram_username = s.instagram_username
          AND s2.shortcode = s.shortcode
      )
    GROUP BY s.instagram_username;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION QUERIES (Run these to test)
-- ============================================================================

-- Test 1: Compare Post Date vs Accrual for a campaign
-- SELECT * FROM campaign_participant_totals_v2('your-campaign-id', '2025-11-01', '2025-11-30', 'post_date');
-- SELECT * FROM campaign_participant_totals_v2('your-campaign-id', '2025-11-01', '2025-11-30', 'accrual');

-- Test 2: Verify single video delta calculation
-- SELECT 
--   tiktok_username,
--   aweme_id,
--   snapshot_date,
--   play_count,
--   LAG(play_count) OVER (PARTITION BY aweme_id ORDER BY snapshot_date) as prev_views,
--   play_count - LAG(play_count) OVER (PARTITION BY aweme_id ORDER BY snapshot_date) as view_delta
-- FROM campaign_participants_snapshot
-- WHERE campaign_id = 'your-campaign-id'
--   AND tiktok_username = 'test-user'
-- ORDER BY aweme_id, snapshot_date;
-- Persistent retry queue for platform refreshes
create table if not exists refresh_retry_queue (
  id bigserial primary key,
  platform text not null check (platform in ('tiktok','instagram')),
  username text not null,
  last_error text,
  retry_count int not null default 0,
  next_retry_at timestamptz not null default now(),
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, username)
);

create index if not exists idx_refresh_retry_queue_due on refresh_retry_queue(platform, next_retry_at);

-- trigger to update updated_at
create or replace function set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_refresh_retry_queue_updated_at on refresh_retry_queue;
create trigger trg_refresh_retry_queue_updated_at
before update on refresh_retry_queue
for each row execute procedure set_updated_at_timestamp();
-- Employee Historical Metrics Table for Manual Data Entry
-- Support custom date ranges for employee metrics (not fixed weekly)
-- Date: 2026-01-06

BEGIN;

-- Create table for storing custom period historical data manually entered by admin
-- This stores TOTAL aggregate data (not per employee)
CREATE TABLE IF NOT EXISTS public.employee_historical_metrics (
  id SERIAL PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'all')),
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  saves BIGINT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ensure start_date is before end_date
  CONSTRAINT valid_date_range CHECK (start_date <= end_date),
  -- Ensure no overlapping periods for same platform
  CONSTRAINT unique_period_platform UNIQUE (start_date, end_date, platform)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_employee_historical_employee ON public.employee_historical_metrics(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_historical_dates ON public.employee_historical_metrics(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_employee_historical_platform ON public.employee_historical_metrics(platform);

-- RLS Policies
ALTER TABLE public.employee_historical_metrics ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read
CREATE POLICY "Allow read access to all authenticated users" 
  ON public.employee_historical_metrics FOR SELECT 
  USING (auth.role() = 'authenticated');

-- Allow all authenticated users to insert/update/delete (for admin purposes)
CREATE POLICY "Allow write access to authenticated users" 
  ON public.employee_historical_metrics FOR ALL 
  USING (auth.role() = 'authenticated');

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_employee_historical_metrics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_employee_historical_metrics_timestamp ON public.employee_historical_metrics;
CREATE TRIGGER trigger_update_employee_historical_metrics_timestamp
  BEFORE UPDATE ON public.employee_historical_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_employee_historical_metrics_timestamp();

COMMIT;
-- Remove employee_id from employee_historical_metrics
-- Change to aggregate total data (no per-employee tracking)
-- Date: 2026-01-06

BEGIN;

-- Drop the foreign key constraint if exists
ALTER TABLE public.employee_historical_metrics 
  DROP CONSTRAINT IF EXISTS employee_historical_metrics_employee_id_fkey;

-- Drop the employee_id column
ALTER TABLE public.employee_historical_metrics 
  DROP COLUMN IF EXISTS employee_id;

-- Update unique constraint to remove employee_id
ALTER TABLE public.employee_historical_metrics 
  DROP CONSTRAINT IF EXISTS unique_employee_period;

-- Drop if exists first to avoid "already exists" error
ALTER TABLE public.employee_historical_metrics 
  DROP CONSTRAINT IF EXISTS unique_period_platform;

-- Add the new constraint
ALTER TABLE public.employee_historical_metrics 
  ADD CONSTRAINT unique_period_platform UNIQUE (start_date, end_date, platform);

COMMIT;

COMMIT;
-- Create table for manual weekly historical data input
CREATE TABLE IF NOT EXISTS weekly_historical_data (
  id BIGSERIAL PRIMARY KEY,
  
  -- Week identification
  week_label TEXT NOT NULL, -- e.g., "W1 Agustus", "W2 September"
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  year INTEGER NOT NULL, -- e.g., 2025
  month INTEGER NOT NULL, -- 1-12
  week_num INTEGER NOT NULL, -- Week number in month (1-5)
  
  -- Campaign/Group identification (NULL = total across all)
  campaign_id TEXT, -- Can be NULL for total data
  group_name TEXT, -- Optional group/campaign name
  
  -- Platform
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'all')),
  
  -- Metrics
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  saves BIGINT DEFAULT 0,
  
  -- Metadata
  notes TEXT, -- Optional notes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(week_label, year, month, week_num, campaign_id, platform)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_weekly_hist_dates ON weekly_historical_data(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_weekly_hist_campaign ON weekly_historical_data(campaign_id);
CREATE INDEX IF NOT EXISTS idx_weekly_hist_platform ON weekly_historical_data(platform);
CREATE INDEX IF NOT EXISTS idx_weekly_hist_year_month ON weekly_historical_data(year, month);

-- Enable RLS
ALTER TABLE weekly_historical_data ENABLE ROW LEVEL SECURITY;

-- Allow public read access (same as other metrics tables)
CREATE POLICY "Allow public read on weekly_historical_data" ON weekly_historical_data
  FOR SELECT USING (true);

-- Allow authenticated insert/update/delete (admin only)
CREATE POLICY "Allow authenticated write on weekly_historical_data" ON weekly_historical_data
  FOR ALL USING (auth.role() = 'authenticated');

-- Update trigger
CREATE OR REPLACE FUNCTION update_weekly_historical_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER weekly_historical_updated_at_trigger
  BEFORE UPDATE ON weekly_historical_data
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_historical_updated_at();

-- Helper function to parse week label and generate dates
CREATE OR REPLACE FUNCTION parse_week_label(label TEXT, year_val INTEGER)
RETURNS TABLE(start_date DATE, end_date DATE, month_num INTEGER, week_num INTEGER) AS $$
DECLARE
  month_name TEXT;
  week_str TEXT;
  week_number INTEGER;
  month_number INTEGER;
  month_start DATE;
  week_start DATE;
BEGIN
  -- Extract "W1" and "Agustus" from "W1 Agustus"
  week_str := SUBSTRING(label FROM 'W(\d+)');
  month_name := TRIM(SUBSTRING(label FROM 'W\d+\s+(.+)'));
  week_number := week_str::INTEGER;
  
  -- Map Indonesian month names to numbers
  month_number := CASE LOWER(month_name)
    WHEN 'januari' THEN 1
    WHEN 'februari' THEN 2
    WHEN 'maret' THEN 3
    WHEN 'april' THEN 4
    WHEN 'mei' THEN 5
    WHEN 'juni' THEN 6
    WHEN 'juli' THEN 7
    WHEN 'agustus' THEN 8
    WHEN 'september' THEN 9
    WHEN 'oktober' THEN 10
    WHEN 'november' THEN 11
    WHEN 'desember' THEN 12
    ELSE NULL
  END;
  
  IF month_number IS NULL THEN
    RAISE EXCEPTION 'Invalid month name: %', month_name;
  END IF;
  
  -- Calculate week start date
  -- W1 starts on first Friday of month (or first day if month starts on Friday)
  -- For simplicity, W1 = days 1-7, W2 = 8-14, W3 = 15-21, W4 = 22-28, W5 = 29-31
  week_start := DATE(year_val || '-' || month_number || '-01') + ((week_number - 1) * 7);
  
  RETURN QUERY SELECT 
    week_start AS start_date,
    LEAST(week_start + 6, (DATE(year_val || '-' || month_number || '-01') + INTERVAL '1 month' - INTERVAL '1 day')::DATE) AS end_date,
    month_number AS month_num,
    week_number AS week_num;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE weekly_historical_data IS 'Manual input for weekly historical metrics data';
-- Add taken_at column to store actual video creation timestamp
-- For both Instagram and TikTok posts
-- Date: 2026-01-09

BEGIN;

-- Instagram: Add column to store the original taken_at timestamp
ALTER TABLE public.instagram_posts_daily 
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_taken_at 
  ON public.instagram_posts_daily(taken_at);

-- TikTok: Add column to store the original create_time timestamp  
ALTER TABLE public.tiktok_posts_daily 
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_taken_at 
  ON public.tiktok_posts_daily(taken_at);

COMMIT;
-- Cleanup: Drop unused/unrestricted tables
-- Date: 2026-01-26
-- WARNING: Verify these tables are truly unused before running!

-- ========================================
-- ANALYSIS: Which tables are safe to drop?
-- ========================================
-- Based on code search:
-- 1. instagram_posts_daily_norm - VIEW only, never queried in app code
-- 2. groups_total_metrics - No references found in codebase
-- 3. group_leaderboard - VIEW, but logic moved to API endpoints
--
-- Tables that MUST NOT be dropped (still in use):
-- - employee_participants: Used in campaigns
-- - tiktok_posts_daily: Core table
-- - user_instagram_usernames: Mapping table, actively used
-- - user_tiktok_usernames: Mapping table, actively used

BEGIN;

-- ========================================
-- STEP 1: Drop unused views
-- ========================================

-- Drop instagram_posts_daily_norm view (if exists)
DROP VIEW IF EXISTS public.instagram_posts_daily_norm CASCADE;

-- Drop group_leaderboard view (logic moved to /api/leaderboard)
DROP VIEW IF EXISTS public.group_leaderboard CASCADE;

-- ========================================
-- STEP 2: Drop unused tables
-- ========================================

-- Drop groups_total_metrics if it exists (no references in code)
DROP TABLE IF EXISTS public.groups_total_metrics CASCADE;

-- Log what was dropped
DO $$
BEGIN
  RAISE NOTICE 'Cleanup complete:';
  RAISE NOTICE '  - Dropped view: instagram_posts_daily_norm (unused)';
  RAISE NOTICE '  - Dropped view: group_leaderboard (moved to API)';
  RAISE NOTICE '  - Dropped table: groups_total_metrics (unused)';
END $$;

COMMIT;

-- ========================================
-- VERIFICATION: Confirm required tables still exist
-- ========================================
DO $$
DECLARE
  required_tables TEXT[] := ARRAY[
    'users',
    'tiktok_posts_daily',
    'instagram_posts_daily',
    'campaigns',
    'campaign_participants',
    'campaign_instagram_participants',
    'employee_participants',
    'employee_instagram_participants',
    'social_metrics',
    'social_metrics_history',
    'user_tiktok_usernames',
    'user_instagram_usernames',
    'groups',
    'group_participants',
    'employee_groups',
    'instagram_user_ids'
  ];
  tbl TEXT;
  missing_count INTEGER := 0;
BEGIN
  FOREACH tbl IN ARRAY required_tables
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      RAISE WARNING 'MISSING REQUIRED TABLE: %', tbl;
      missing_count := missing_count + 1;
    END IF;
  END LOOP;
  
  IF missing_count = 0 THEN
    RAISE NOTICE 'All % required tables verified ✓', array_length(required_tables, 1);
  ELSE
    RAISE EXCEPTION 'Found % missing required tables! Rollback recommended.', missing_count;
  END IF;
END $$;
-- Migration: Replace post_date (DATE) with taken_at (TIMESTAMPTZ)
-- Date: 2026-01-26
-- Impact: All queries now use precise timestamps instead of dates
-- Reason: Better accuracy for accrual calculations and video tracking

BEGIN;

-- ========================================
-- STEP 1: Add taken_at column to tiktok_posts_daily
-- ========================================
ALTER TABLE public.tiktok_posts_daily
  ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

-- Backfill: Convert post_date to taken_at (midnight UTC)
UPDATE public.tiktok_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL AND post_date IS NOT NULL;

-- Create index on taken_at
CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_taken_at 
  ON public.tiktok_posts_daily(taken_at);

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_daily_username_taken_at 
  ON public.tiktok_posts_daily(username, taken_at);

-- ========================================
-- STEP 2: Add taken_at column to instagram_posts_daily
-- ========================================
-- Note: instagram_posts_daily already has taken_at from 2026-01-09 migration
-- Backfill if any rows missing
UPDATE public.instagram_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL AND post_date IS NOT NULL;

-- Create indexes on taken_at
CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_taken_at 
  ON public.instagram_posts_daily(taken_at);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_daily_username_taken_at 
  ON public.instagram_posts_daily(username, taken_at);

-- ========================================
-- STEP 3: Update views that reference post_date
-- ========================================

-- Drop and recreate group_leaderboard view if exists
DROP VIEW IF EXISTS public.group_leaderboard CASCADE;

-- Note: group_leaderboard will be recreated if needed by application logic
-- or can be removed entirely if unused (see cleanup script)

-- ========================================
-- STEP 4: Verify data integrity
-- ========================================

-- Check for NULL taken_at values in TikTok
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.tiktok_posts_daily
  WHERE taken_at IS NULL;
  
  IF null_count > 0 THEN
    RAISE WARNING 'Found % rows with NULL taken_at in tiktok_posts_daily', null_count;
  ELSE
    RAISE NOTICE 'All tiktok_posts_daily rows have taken_at values';
  END IF;
END $$;

-- Check for NULL taken_at values in Instagram
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.instagram_posts_daily
  WHERE taken_at IS NULL;
  
  IF null_count > 0 THEN
    RAISE WARNING 'Found % rows with NULL taken_at in instagram_posts_daily', null_count;
  ELSE
    RAISE NOTICE 'All instagram_posts_daily rows have taken_at values';
  END IF;
END $$;

-- ========================================
-- STEP 5: Add NOT NULL constraint after backfill
-- ========================================

-- Set NOT NULL constraint on taken_at (after verifying all data is backfilled)
-- Uncomment these after confirming all data is migrated:
-- ALTER TABLE public.tiktok_posts_daily 
--   ALTER COLUMN taken_at SET NOT NULL;

-- ALTER TABLE public.instagram_posts_daily 
--   ALTER COLUMN taken_at SET NOT NULL;

COMMIT;

-- ========================================
-- STEP 6: Drop post_date columns (DANGEROUS - Run separately after testing!)
-- ========================================
-- WARNING: Only run this after confirming all application code is updated
-- and tested in production for at least 1 week

-- BEGIN;
-- 
-- -- Drop old indexes on post_date
-- DROP INDEX IF EXISTS public.idx_tiktok_posts_daily_post_date;
-- DROP INDEX IF EXISTS public.idx_tiktok_posts_daily_username_post_date;
-- DROP INDEX IF EXISTS public.idx_instagram_posts_daily_post_date;
-- DROP INDEX IF EXISTS public.idx_instagram_posts_daily_user_date;
-- 
-- -- Drop post_date columns
-- ALTER TABLE public.tiktok_posts_daily DROP COLUMN IF EXISTS post_date;
-- ALTER TABLE public.instagram_posts_daily DROP COLUMN IF EXISTS post_date;
-- 
-- COMMIT;
-- Fix employee_total_metrics to use user_tiktok_usernames and user_instagram_usernames
-- This ensures metrics stay in sync when usernames are updated/deleted
-- Date: 2026-01-27

BEGIN;

-- Drop existing materialized view
DROP MATERIALIZED VIEW IF EXISTS public.employee_total_metrics CASCADE;

-- Recreate with proper username source from mapping tables
CREATE MATERIALIZED VIEW public.employee_total_metrics AS
WITH tiktok_totals AS (
  -- Aggregate TikTok metrics using user_tiktok_usernames (source of truth)
  SELECT 
    utu.user_id,
    SUM(COALESCE(tpd.play_count, 0)) as tiktok_views,
    SUM(COALESCE(tpd.digg_count, 0)) as tiktok_likes,
    SUM(COALESCE(tpd.comment_count, 0)) as tiktok_comments,
    SUM(COALESCE(tpd.share_count, 0)) as tiktok_shares,
    0 as tiktok_followers,
    MAX(tpd.created_at) as tiktok_last_updated
  FROM public.user_tiktok_usernames utu
  JOIN public.tiktok_posts_daily tpd 
    ON LOWER(utu.tiktok_username) = LOWER(tpd.username)
  GROUP BY utu.user_id
),
instagram_totals AS (
  -- Aggregate Instagram metrics using user_instagram_usernames (source of truth)
  SELECT
    uiu.user_id,
    SUM(COALESCE(ipd.play_count, 0)) as instagram_views,
    SUM(COALESCE(ipd.like_count, 0)) as instagram_likes,
    SUM(COALESCE(ipd.comment_count, 0)) as instagram_comments,
    0 as instagram_shares,
    0 as instagram_followers,
    MAX(ipd.created_at) as instagram_last_updated
  FROM public.user_instagram_usernames uiu
  JOIN public.instagram_posts_daily ipd 
    ON LOWER(uiu.instagram_username) = LOWER(ipd.username)
  GROUP BY uiu.user_id
),
all_usernames AS (
  -- Get all TikTok usernames per user
  SELECT 
    user_id,
    ARRAY_AGG(DISTINCT tiktok_username) as tiktok_usernames
  FROM public.user_tiktok_usernames
  GROUP BY user_id
),
all_ig_usernames AS (
  -- Get all Instagram usernames per user
  SELECT 
    user_id,
    ARRAY_AGG(DISTINCT instagram_username) as instagram_usernames
  FROM public.user_instagram_usernames
  GROUP BY user_id
)
SELECT
  u.id as employee_id,
  u.full_name,
  u.username,
  u.email,
  u.profile_picture_url,
  -- TikTok totals
  COALESCE(tt.tiktok_views, 0) as total_tiktok_views,
  COALESCE(tt.tiktok_likes, 0) as total_tiktok_likes,
  COALESCE(tt.tiktok_comments, 0) as total_tiktok_comments,
  COALESCE(tt.tiktok_shares, 0) as total_tiktok_shares,
  COALESCE(tt.tiktok_followers, 0) as total_tiktok_followers,
  -- Instagram totals
  COALESCE(it.instagram_views, 0) as total_instagram_views,
  COALESCE(it.instagram_likes, 0) as total_instagram_likes,
  COALESCE(it.instagram_comments, 0) as total_instagram_comments,
  COALESCE(it.instagram_shares, 0) as total_instagram_shares,
  COALESCE(it.instagram_followers, 0) as total_instagram_followers,
  -- Combined totals
  COALESCE(tt.tiktok_views, 0) + COALESCE(it.instagram_views, 0) as total_views,
  COALESCE(tt.tiktok_likes, 0) + COALESCE(it.instagram_likes, 0) as total_likes,
  COALESCE(tt.tiktok_comments, 0) + COALESCE(it.instagram_comments, 0) as total_comments,
  COALESCE(tt.tiktok_shares, 0) + COALESCE(it.instagram_shares, 0) as total_shares,
  -- Usernames from mapping tables (arrays for multiple usernames)
  COALESCE(au.tiktok_usernames, ARRAY[]::TEXT[]) as tiktok_usernames,
  COALESCE(aiu.instagram_usernames, ARRAY[]::TEXT[]) as instagram_usernames,
  -- Last updated timestamps
  tt.tiktok_last_updated,
  it.instagram_last_updated,
  GREATEST(
    COALESCE(tt.tiktok_last_updated, '1970-01-01'::TIMESTAMP),
    COALESCE(it.instagram_last_updated, '1970-01-01'::TIMESTAMP)
  ) as last_updated
FROM public.users u
LEFT JOIN tiktok_totals tt ON u.id = tt.user_id
LEFT JOIN instagram_totals it ON u.id = it.user_id
LEFT JOIN all_usernames au ON u.id = au.user_id
LEFT JOIN all_ig_usernames aiu ON u.id = aiu.user_id
WHERE u.role = 'karyawan';

-- Create index for fast lookups
CREATE UNIQUE INDEX idx_employee_total_metrics_employee_id 
  ON public.employee_total_metrics(employee_id);

-- Grant permissions
GRANT SELECT ON public.employee_total_metrics TO authenticated;

-- Initial refresh
REFRESH MATERIALIZED VIEW public.employee_total_metrics;

COMMIT;

-- Verification query
DO $$
DECLARE
  total_employees INT;
  employees_with_tiktok INT;
  employees_with_instagram INT;
BEGIN
  SELECT COUNT(*) INTO total_employees FROM public.employee_total_metrics;
  SELECT COUNT(*) INTO employees_with_tiktok FROM public.employee_total_metrics WHERE array_length(tiktok_usernames, 1) > 0;
  SELECT COUNT(*) INTO employees_with_instagram FROM public.employee_total_metrics WHERE array_length(instagram_usernames, 1) > 0;
  
  RAISE NOTICE '✓ employee_total_metrics recreated successfully';
  RAISE NOTICE '  - Total employees: %', total_employees;
  RAISE NOTICE '  - Employees with TikTok usernames: %', employees_with_tiktok;
  RAISE NOTICE '  - Employees with Instagram usernames: %', employees_with_instagram;
END $$;
-- Verification and Fix Script: Ensure all taken_at columns are populated
-- Date: 2026-01-27
-- Purpose: Verify migration success and fix any NULL taken_at values

BEGIN;

-- ========================================
-- STEP 1: Comprehensive Backfill for TikTok
-- ========================================

-- First attempt: Use post_date if available
UPDATE public.tiktok_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL 
  AND post_date IS NOT NULL;

-- Second attempt: For remaining NULLs, try to parse from video metadata
-- If still NULL after post_date backfill, set to creation timestamp
UPDATE public.tiktok_posts_daily
SET taken_at = created_at
WHERE taken_at IS NULL 
  AND created_at IS NOT NULL;

-- Last resort: Use current timestamp (rare case)
UPDATE public.tiktok_posts_daily
SET taken_at = NOW()
WHERE taken_at IS NULL;

-- ========================================
-- STEP 2: Comprehensive Backfill for Instagram
-- ========================================

-- First attempt: Use post_date if available
UPDATE public.instagram_posts_daily
SET taken_at = (post_date || 'T00:00:00Z')::timestamptz
WHERE taken_at IS NULL 
  AND post_date IS NOT NULL;

-- Second attempt: Use created_at if available
UPDATE public.instagram_posts_daily
SET taken_at = created_at
WHERE taken_at IS NULL 
  AND created_at IS NOT NULL;

-- Last resort: Use current timestamp
UPDATE public.instagram_posts_daily
SET taken_at = NOW()
WHERE taken_at IS NULL;

-- ========================================
-- STEP 3: Add NOT NULL constraint (after backfill)
-- ========================================

-- Set default for future inserts
ALTER TABLE public.tiktok_posts_daily
  ALTER COLUMN taken_at SET DEFAULT NOW();

ALTER TABLE public.instagram_posts_daily
  ALTER COLUMN taken_at SET DEFAULT NOW();

-- Add NOT NULL constraint (only after all data is backfilled)
-- Uncomment after verifying no NULL values remain:
-- ALTER TABLE public.tiktok_posts_daily
--   ALTER COLUMN taken_at SET NOT NULL;

-- ALTER TABLE public.instagram_posts_daily
--   ALTER COLUMN taken_at SET NOT NULL;

-- ========================================
-- STEP 4: Verification Report
-- ========================================

DO $$
DECLARE
  tt_total INTEGER;
  tt_null INTEGER;
  tt_filled INTEGER;
  ig_total INTEGER;
  ig_null INTEGER;
  ig_filled INTEGER;
BEGIN
  -- TikTok stats
  SELECT COUNT(*) INTO tt_total FROM public.tiktok_posts_daily;
  SELECT COUNT(*) INTO tt_null FROM public.tiktok_posts_daily WHERE taken_at IS NULL;
  tt_filled := tt_total - tt_null;
  
  -- Instagram stats
  SELECT COUNT(*) INTO ig_total FROM public.instagram_posts_daily;
  SELECT COUNT(*) INTO ig_null FROM public.instagram_posts_daily WHERE taken_at IS NULL;
  ig_filled := ig_total - ig_null;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'VERIFICATION REPORT: taken_at Migration';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'TikTok Posts:';
  RAISE NOTICE '  Total rows: %', tt_total;
  RAISE NOTICE '  Filled taken_at: % (%.2f%%)', tt_filled, (tt_filled::float / NULLIF(tt_total, 0) * 100);
  RAISE NOTICE '  NULL taken_at: % (%.2f%%)', tt_null, (tt_null::float / NULLIF(tt_total, 0) * 100);
  RAISE NOTICE '';
  RAISE NOTICE 'Instagram Posts:';
  RAISE NOTICE '  Total rows: %', ig_total;
  RAISE NOTICE '  Filled taken_at: % (%.2f%%)', ig_filled, (ig_filled::float / NULLIF(ig_total, 0) * 100);
  RAISE NOTICE '  NULL taken_at: % (%.2f%%)', ig_null, (ig_null::float / NULLIF(ig_total, 0) * 100);
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  
  IF tt_null > 0 THEN
    RAISE WARNING 'TikTok: % rows still have NULL taken_at!', tt_null;
  ELSE
    RAISE NOTICE '✓ TikTok: All rows have taken_at populated';
  END IF;
  
  IF ig_null > 0 THEN
    RAISE WARNING 'Instagram: % rows still have NULL taken_at!', ig_null;
  ELSE
    RAISE NOTICE '✓ Instagram: All rows have taken_at populated';
  END IF;
  
  RAISE NOTICE '========================================';
END $$;

-- ========================================
-- STEP 5: Sample Data Check
-- ========================================

-- Show sample TikTok data
DO $$ BEGIN RAISE NOTICE 'Sample TikTok data (first 5 rows):'; END $$;
SELECT 
  video_id,
  username,
  post_date,
  taken_at,
  CASE 
    WHEN taken_at IS NULL THEN 'NULL'
    ELSE '✓'
  END as status
FROM public.tiktok_posts_daily
ORDER BY created_at DESC
LIMIT 5;

-- Show sample Instagram data
DO $$ BEGIN RAISE NOTICE 'Sample Instagram data (first 5 rows):'; END $$;
SELECT 
  id,
  username,
  post_date,
  taken_at,
  CASE 
    WHEN taken_at IS NULL THEN 'NULL'
    ELSE '✓'
  END as status
FROM public.instagram_posts_daily
ORDER BY created_at DESC
LIMIT 5;

COMMIT;

-- ========================================
-- MANUAL VERIFICATION QUERIES
-- ========================================

-- Run these separately to check specific cases:

-- 1. Check for any NULL taken_at in TikTok
-- SELECT COUNT(*) as null_count FROM tiktok_posts_daily WHERE taken_at IS NULL;

-- 2. Check for any NULL taken_at in Instagram
-- SELECT COUNT(*) as null_count FROM instagram_posts_daily WHERE taken_at IS NULL;

-- 3. Compare post_date vs taken_at
-- SELECT 
--   video_id,
--   post_date,
--   taken_at,
--   taken_at::date as taken_at_date,
--   CASE WHEN post_date = taken_at::date THEN '✓' ELSE 'MISMATCH' END as match
-- FROM tiktok_posts_daily
-- WHERE post_date IS NOT NULL
-- LIMIT 20;

-- 4. Check recent inserts (ensure new data uses taken_at)
-- SELECT * FROM tiktok_posts_daily ORDER BY created_at DESC LIMIT 10;
-- SELECT * FROM instagram_posts_daily ORDER BY created_at DESC LIMIT 10;
-- Create analytics_tracked_accounts table
-- This table stores accounts to be tracked in Analytics page

CREATE TABLE IF NOT EXISTS analytics_tracked_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('tiktok','instagram')),
  username TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, username)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_analytics_tracked_platform ON analytics_tracked_accounts(platform);

-- Enable RLS
ALTER TABLE analytics_tracked_accounts ENABLE ROW LEVEL SECURITY;

-- Allow admin to manage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_analytics_tracked' AND tablename = 'analytics_tracked_accounts') THEN
    CREATE POLICY admin_analytics_tracked ON analytics_tracked_accounts FOR ALL USING (
      EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','super_admin'))
    );
  END IF;
END$$;

-- Populate from existing user_tiktok_usernames
INSERT INTO analytics_tracked_accounts (platform, username, label)
SELECT DISTINCT 
  'tiktok',
  tiktok_username,
  NULL
FROM user_tiktok_usernames
WHERE tiktok_username IS NOT NULL AND tiktok_username != ''
ON CONFLICT (platform, username) DO NOTHING;

-- Populate from existing user_instagram_usernames
INSERT INTO analytics_tracked_accounts (platform, username, label)
SELECT DISTINCT 
  'instagram',
  instagram_username,
  NULL
FROM user_instagram_usernames
WHERE instagram_username IS NOT NULL AND instagram_username != ''
ON CONFLICT (platform, username) DO NOTHING;

-- Verify
SELECT platform, COUNT(*) as count FROM analytics_tracked_accounts GROUP BY platform;
-- Auto-Sync Triggers for Employee Participants
-- Ensures employee_tiktok_participants and employee_instagram_participants 
-- stay in sync with user_*_usernames tables

BEGIN;

-- =====================================================
-- TIKTOK TRIGGERS
-- =====================================================

-- Function: Auto-insert to employee_tiktok_participants when username added
CREATE OR REPLACE FUNCTION fn_sync_tiktok_username_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert to all campaigns for this user
  INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
  SELECT 
    NEW.user_id,
    c.id,
    NEW.tiktok_username,
    NOW()
  FROM public.campaigns c
  ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After INSERT on user_tiktok_usernames
DROP TRIGGER IF EXISTS trg_sync_tiktok_username_insert ON public.user_tiktok_usernames;
CREATE TRIGGER trg_sync_tiktok_username_insert
  AFTER INSERT ON public.user_tiktok_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_tiktok_username_insert();

-- Function: Auto-delete from employee_tiktok_participants when username removed
CREATE OR REPLACE FUNCTION fn_sync_tiktok_username_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete from employee_tiktok_participants
  DELETE FROM public.employee_tiktok_participants
  WHERE employee_id = OLD.user_id 
    AND tiktok_username = OLD.tiktok_username;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After DELETE on user_tiktok_usernames
DROP TRIGGER IF EXISTS trg_sync_tiktok_username_delete ON public.user_tiktok_usernames;
CREATE TRIGGER trg_sync_tiktok_username_delete
  AFTER DELETE ON public.user_tiktok_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_tiktok_username_delete();

-- Function: Auto-update employee_tiktok_participants when username changed
CREATE OR REPLACE FUNCTION fn_sync_tiktok_username_update()
RETURNS TRIGGER AS $$
BEGIN
  -- If username changed, update all references
  IF OLD.tiktok_username != NEW.tiktok_username THEN
    UPDATE public.employee_tiktok_participants
    SET tiktok_username = NEW.tiktok_username
    WHERE employee_id = NEW.user_id 
      AND tiktok_username = OLD.tiktok_username;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After UPDATE on user_tiktok_usernames
DROP TRIGGER IF EXISTS trg_sync_tiktok_username_update ON public.user_tiktok_usernames;
CREATE TRIGGER trg_sync_tiktok_username_update
  AFTER UPDATE ON public.user_tiktok_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_tiktok_username_update();

-- =====================================================
-- INSTAGRAM TRIGGERS
-- =====================================================

-- Function: Auto-insert to employee_instagram_participants when username added
CREATE OR REPLACE FUNCTION fn_sync_instagram_username_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert to all campaigns for this user
  INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
  SELECT 
    NEW.user_id,
    c.id,
    NEW.instagram_username,
    NOW()
  FROM public.campaigns c
  ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After INSERT on user_instagram_usernames
DROP TRIGGER IF EXISTS trg_sync_instagram_username_insert ON public.user_instagram_usernames;
CREATE TRIGGER trg_sync_instagram_username_insert
  AFTER INSERT ON public.user_instagram_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_instagram_username_insert();

-- Function: Auto-delete from employee_instagram_participants when username removed
CREATE OR REPLACE FUNCTION fn_sync_instagram_username_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete from employee_instagram_participants
  DELETE FROM public.employee_instagram_participants
  WHERE employee_id = OLD.user_id 
    AND instagram_username = OLD.instagram_username;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After DELETE on user_instagram_usernames
DROP TRIGGER IF EXISTS trg_sync_instagram_username_delete ON public.user_instagram_usernames;
CREATE TRIGGER trg_sync_instagram_username_delete
  AFTER DELETE ON public.user_instagram_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_instagram_username_delete();

-- Function: Auto-update employee_instagram_participants when username changed
CREATE OR REPLACE FUNCTION fn_sync_instagram_username_update()
RETURNS TRIGGER AS $$
BEGIN
  -- If username changed, update all references
  IF OLD.instagram_username != NEW.instagram_username THEN
    UPDATE public.employee_instagram_participants
    SET instagram_username = NEW.instagram_username
    WHERE employee_id = NEW.user_id 
      AND instagram_username = OLD.instagram_username;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After UPDATE on user_instagram_usernames
DROP TRIGGER IF EXISTS trg_sync_instagram_username_update ON public.user_instagram_usernames;
CREATE TRIGGER trg_sync_instagram_username_update
  AFTER UPDATE ON public.user_instagram_usernames
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_instagram_username_update();

-- =====================================================
-- CAMPAIGN TRIGGERS (Optional)
-- =====================================================

-- Function: Auto-populate new campaign with existing usernames
CREATE OR REPLACE FUNCTION fn_sync_new_campaign_participants()
RETURNS TRIGGER AS $$
BEGIN
  -- Populate TikTok participants for new campaign
  INSERT INTO public.employee_tiktok_participants (employee_id, campaign_id, tiktok_username, created_at)
  SELECT 
    utu.user_id,
    NEW.id,
    utu.tiktok_username,
    NOW()
  FROM public.user_tiktok_usernames utu
  ON CONFLICT (employee_id, campaign_id, tiktok_username) DO NOTHING;
  
  -- Populate Instagram participants for new campaign
  INSERT INTO public.employee_instagram_participants (employee_id, campaign_id, instagram_username, created_at)
  SELECT 
    uiu.user_id,
    NEW.id,
    uiu.instagram_username,
    NOW()
  FROM public.user_instagram_usernames uiu
  ON CONFLICT (employee_id, campaign_id, instagram_username) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After INSERT on campaigns
DROP TRIGGER IF EXISTS trg_sync_new_campaign_participants ON public.campaigns;
CREATE TRIGGER trg_sync_new_campaign_participants
  AFTER INSERT ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_new_campaign_participants();

COMMIT;

-- Verification: Check triggers are created
SELECT 
  trigger_name,
  event_object_table,
  event_manipulation,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name LIKE 'trg_sync%'
ORDER BY event_object_table, trigger_name;
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
-- Create employee_tiktok_participants table
-- Stores TikTok usernames assigned to employees per campaign
-- Mirror of employee_instagram_participants but for TikTok

BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_tiktok_participants (
  employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  tiktok_username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, campaign_id, tiktok_username)
);

CREATE INDEX IF NOT EXISTS employee_tiktok_participants_campaign_idx ON public.employee_tiktok_participants(campaign_id);
CREATE INDEX IF NOT EXISTS employee_tiktok_participants_username_idx ON public.employee_tiktok_participants(tiktok_username);

ALTER TABLE public.employee_tiktok_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Admin manage employee_tiktok_participants' AND tablename='employee_tiktok_participants') THEN
    CREATE POLICY "Admin manage employee_tiktok_participants" ON public.employee_tiktok_participants FOR ALL
      USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
      WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');
  END IF;
END $$;

COMMIT;
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
BEGIN;

-- Add is_head column to employee_groups to designate group leaders
ALTER TABLE public.employee_groups 
ADD COLUMN IF NOT EXISTS is_head BOOLEAN DEFAULT FALSE;

COMMIT;
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
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS youtube_channel_id TEXT;

COMMIT;
ALTER TABLE weekly_historical_data DROP CONSTRAINT IF EXISTS weekly_historical_data_platform_check;
ALTER TABLE weekly_historical_data ADD CONSTRAINT weekly_historical_data_platform_check CHECK (platform IN ('TIKTOK', 'INSTAGRAM', 'YOUTUBE', 'tiktok', 'instagram', 'youtube', 'all', 'ALL'));
-- Add shortcode column to youtube_posts_daily for cross-platform consistency
-- Date: 2026-02-11

BEGIN;

ALTER TABLE public.youtube_posts_daily
  ADD COLUMN IF NOT EXISTS shortcode TEXT;

-- Backfill existing rows: for YouTube, shortcode == video id
UPDATE public.youtube_posts_daily
  SET shortcode = id
  WHERE shortcode IS NULL;

-- Optional: index to speed lookups by shortcode
CREATE INDEX IF NOT EXISTS idx_youtube_posts_daily_shortcode ON public.youtube_posts_daily(shortcode);

COMMIT;
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

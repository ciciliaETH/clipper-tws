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

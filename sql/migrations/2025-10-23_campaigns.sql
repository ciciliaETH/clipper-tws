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

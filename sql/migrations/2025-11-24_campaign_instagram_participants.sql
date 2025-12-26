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

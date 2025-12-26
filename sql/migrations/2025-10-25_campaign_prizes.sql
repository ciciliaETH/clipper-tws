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

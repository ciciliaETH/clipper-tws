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

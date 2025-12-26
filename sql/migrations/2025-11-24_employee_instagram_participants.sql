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

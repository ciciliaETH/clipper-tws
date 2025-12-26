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

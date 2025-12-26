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

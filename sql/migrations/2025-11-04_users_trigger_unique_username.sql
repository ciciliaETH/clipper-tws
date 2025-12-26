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
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'handle_new_user') THEN
    DROP TRIGGER handle_new_user ON auth.users;
  END IF;
END$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

COMMIT;

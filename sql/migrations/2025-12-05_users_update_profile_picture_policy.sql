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

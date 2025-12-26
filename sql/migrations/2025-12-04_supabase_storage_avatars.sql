-- Supabase Storage setup for profile pictures
-- Create bucket and set RLS policies
-- Date: 2025-12-04

BEGIN;

-- 1. Create storage bucket 'avatars' (if not exists via UI, this ensures policies)
-- Note: Bucket creation is typically done via Supabase UI, but policies must be in SQL

-- 2. Enable RLS on storage.objects (should already be enabled by default)
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 3. Policy: Allow authenticated users to upload to their own folder in avatars bucket
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can upload own profile pictures'
  ) THEN
    CREATE POLICY "Users can upload own profile pictures"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

-- 4. Policy: Allow authenticated users to read all avatars (public bucket)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Anyone can view avatars'
  ) THEN
    CREATE POLICY "Anyone can view avatars"
    ON storage.objects
    FOR SELECT
    TO public
    USING (bucket_id = 'avatars');
  END IF;
END $$;

-- 5. Policy: Allow users to update their own profile pictures
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can update own profile pictures'
  ) THEN
    CREATE POLICY "Users can update own profile pictures"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    )
    WITH CHECK (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

-- 6. Policy: Allow users to delete their own old profile pictures
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Users can delete own profile pictures'
  ) THEN
    CREATE POLICY "Users can delete own profile pictures"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'avatars' 
      AND (storage.foldername(name))[1] = 'profile-pictures'
    );
  END IF;
END $$;

COMMIT;

-- Check if profile_picture_url column exists in users table
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'users'
  AND column_name = 'profile_picture_url';

-- If empty result, run this to add the column:
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;

-- Check current values
SELECT id, username, profile_picture_url 
FROM public.users 
LIMIT 10;

-- Add password field to profiles table
-- ⚠️ SECURITY WARNING: Storing passwords in plain text is a security risk!
-- Supabase already stores hashed passwords in auth.users table.
-- This field is only for reference/display purposes if needed.

-- Add password column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS password TEXT;

-- Add a comment explaining this is for display only
COMMENT ON COLUMN public.profiles.password IS '⚠️ WARNING: If storing passwords here, they should be hashed. Supabase auth.users already stores hashed passwords securely.';

-- Update RLS policy to allow users to see passwords (if needed)
-- Note: You may want to restrict this further based on your security needs
-- Currently, if profiles are readable, passwords will be readable too

-- Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'profiles' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Fix RLS policies for submissions table
-- This allows anyone in the room to see submissions for active rounds
-- Judges need to see all submissions to pick a winner

-- Ensure RLS is enabled on submissions table
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "submissions_select_own" ON public.submissions;
DROP POLICY IF EXISTS "submissions_select_judge" ON public.submissions;
DROP POLICY IF EXISTS "submissions_select_room" ON public.submissions;
DROP POLICY IF EXISTS "submissions_insert_own" ON public.submissions;

-- Policy 1: Anyone in the room can read submissions for active rounds
-- This allows judges to see all submissions and players to see submissions too
CREATE POLICY "submissions_select_room"
ON public.submissions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.rounds r
    JOIN public.room_players rp ON r.room_id = rp.room_id
    WHERE r.id = submissions.round_id
      AND rp.profile_id = auth.uid()
      AND r.status = 'submitting'
  )
);

-- Policy 2: Players can insert their own submissions (judges cannot submit)
CREATE POLICY "submissions_insert_own"
ON public.submissions
FOR INSERT
TO authenticated
WITH CHECK (
  profile_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.rounds r
    JOIN public.room_players rp ON r.room_id = rp.room_id
    WHERE r.id = submissions.round_id
      AND rp.profile_id = auth.uid()
      AND r.status = 'submitting'
      AND rp.is_judge = false  -- Judges can't submit
  )
);

-- Verify policies were created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'submissions'
ORDER BY policyname;

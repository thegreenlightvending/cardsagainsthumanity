-- Enforce ONE active round per room (prevents judge rotation from getting stuck due to duplicate rounds)
-- Run this in Supabase SQL Editor

-- 1) Only one "submitting" round is allowed per room at a time
CREATE UNIQUE INDEX IF NOT EXISTS rounds_one_submitting_per_room
ON public.rounds (room_id)
WHERE status = 'submitting';

-- 2) Ensure player_hands supports upsert ignoreDuplicates (prevents 409 spam on replenish)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'player_hands_room_profile_white_unique'
      AND n.nspname = 'public'
      AND t.relname = 'player_hands'
  ) THEN
    ALTER TABLE public.player_hands
    ADD CONSTRAINT player_hands_room_profile_white_unique
    UNIQUE (room_id, profile_id, white_card_id);
  END IF;
END $$;

-- Optional sanity checks:
-- SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='rounds';
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='player_hands_room_profile_white_unique';

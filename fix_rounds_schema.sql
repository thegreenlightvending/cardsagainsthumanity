-- Fix rounds.black_card_id to match black_cards.id type (integer/bigint)
-- Run this in your Supabase SQL Editor

-- Step 1: Clear existing rounds (if any)
DELETE FROM rounds;

-- Step 2: Drop foreign key constraint
ALTER TABLE rounds 
DROP CONSTRAINT IF EXISTS rounds_black_card_id_fkey;

-- Step 3: Change black_card_id from UUID to bigint
-- This will work because we cleared the table above
ALTER TABLE rounds 
ALTER COLUMN black_card_id TYPE bigint;

-- Step 4: Re-add foreign key constraint
ALTER TABLE rounds
ADD CONSTRAINT rounds_black_card_id_fkey 
FOREIGN KEY (black_card_id) 
REFERENCES black_cards(id);

-- Step 5: Verify the change
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'rounds' AND column_name = 'black_card_id';
-- Should now show: data_type = 'bigint' (not 'uuid')

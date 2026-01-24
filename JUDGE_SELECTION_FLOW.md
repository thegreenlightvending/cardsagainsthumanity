# Judge Selection Flow - Complete Analysis

## 🎯 Judge Selection Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    GAME START (startGame)                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ 1. Set room status to "playing"        │
        │ 2. Reset all scores to 0             │
        │ 3. Deal 10 cards to each player        │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ createActiveRound(players[0].profile_id)│
        │ → First player (index 0) becomes judge │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 1: Remove judge from all players │
        │ UPDATE room_players SET is_judge=false│
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 2: Set new judge                 │
        │ UPDATE room_players SET is_judge=true  │
        │ WHERE profile_id = judgeProfileId      │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 3: Get random black card         │
        │ SELECT * FROM black_cards              │
        │ WHERE deck_id = room.deck_id           │
        │ → Random selection                     │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 4: Create round with judge        │
        │ INSERT INTO rounds (                   │
        │   room_id,                             │
        │   black_card_id,                       │
        │   judge_profile_id,  ← JUDGE SET HERE │
        │   status = 'submitting'                │
        │ )                                      │
        └───────────────────┬───────────────────┘
                            │
                            ▼
                    ROUND ACTIVE
              (Players submit cards)
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │      JUDGE SELECTS WINNER              │
        │      (selectWinner function)            │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ 1. Award point to winner               │
        │ 2. Mark round as "completed"            │
        │ 3. Wait 3 seconds                      │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │         nextRound() called             │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 1: Get most recent round          │
        │ SELECT judge_profile_id FROM rounds     │
        │ WHERE room_id = ?                      │
        │ ORDER BY id DESC LIMIT 1                │
        │ → Get current judge's profile_id        │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 2: Get all players (ordered)      │
        │ SELECT * FROM room_players             │
        │ WHERE room_id = ?                      │
        │ ORDER BY joined_at ASC                 │
        │ → Players numbered 0, 1, 2, 3...       │
        │   (This is their "player_order")       │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 3: Find current judge index        │
        │ Find player where                      │
        │   profile_id = currentJudgeProfileId   │
        │ → Get their index (player_order)       │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 4: Calculate next judge            │
        │ nextJudgeIndex =                       │
        │   (currentJudgeIndex + 1) %            │
        │   totalPlayers                         │
        │                                        │
        │ Example:                               │
        │ - Current judge: Player 0              │
        │ - Total players: 3                     │
        │ - Next judge: (0 + 1) % 3 = 1         │
        │   → Player 1 becomes judge            │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 5: Replenish cards                │
        │ Ensure all players have 10 cards       │
        └───────────────────┬───────────────────┘
                            │
                            ▼
        ┌───────────────────────────────────────┐
        │ STEP 6: Create new round               │
        │ createActiveRound(nextJudge.profile_id)│
        │ → New judge set, new black card        │
        └───────────────────┬───────────────────┘
                            │
                            ▼
                    NEW ROUND ACTIVE
              (Cycle repeats...)
```

## 📋 Detailed Step-by-Step Flow

### **Initial Game Start** (`startGame` function)

1. **Validation**: Check if at least 3 players
2. **Room Setup**: Set room status to "playing"
3. **Score Reset**: Reset all player scores to 0
4. **Deal Cards**: Deal 10 white cards to each player
5. **Create First Round**: Call `createActiveRound(players[0].profile_id)`
   - First player (index 0) becomes the first judge

### **Creating Active Round** (`createActiveRound` function)

**Input**: `judgeProfileId` (UUID of the player who will be judge)

**Process**:
1. **Remove All Judge Flags**:
   ```sql
   UPDATE room_players 
   SET is_judge = false 
   WHERE room_id = ?
   ```

2. **Set New Judge**:
   ```sql
   UPDATE room_players 
   SET is_judge = true 
   WHERE room_id = ? AND profile_id = judgeProfileId
   ```

3. **Get Random Black Card**:
   ```sql
   SELECT id, text FROM black_cards 
   WHERE deck_id = room.deck_id
   ```
   - Randomly selects one black card

4. **Create Round Record**:
   ```sql
   INSERT INTO rounds (
     room_id,
     black_card_id,
     judge_profile_id,  -- ← JUDGE STORED HERE
     status
   ) VALUES (?, ?, ?, 'submitting')
   ```

**Output**: Returns the new round object

### **Judge Rotation** (`nextRound` function)

**Triggered**: 3 seconds after judge selects a winner

**Process**:

1. **Get Current Judge** (from most recent round):
   ```sql
   SELECT judge_profile_id, id 
   FROM rounds 
   WHERE room_id = ? 
   ORDER BY id DESC 
   LIMIT 1
   ```
   - Gets the `judge_profile_id` from the most recent round
   - This is the **source of truth** for who was just the judge

2. **Get All Players** (ordered by join time):
   ```sql
   SELECT *, profiles(username) 
   FROM room_players 
   WHERE room_id = ? 
   ORDER BY joined_at ASC
   ```
   - Players are returned in join order
   - This creates a consistent "player_order": 0, 1, 2, 3...
   - **This order never changes** - it's based on when they joined

3. **Find Current Judge's Index**:
   ```javascript
   currentJudgeIndex = allPlayers.findIndex(
     p => p.profile_id === currentJudgeProfileId
   )
   ```
   - Finds which position (player_order) the current judge is at
   - Example: If current judge is the 2nd player to join, index = 1

4. **Calculate Next Judge**:
   ```javascript
   nextJudgeIndex = (currentJudgeIndex + 1) % allPlayers.length
   ```
   - Moves to the next player in order
   - Wraps around: if last player (index 2 of 3), next is first (index 0)

5. **Replenish Cards**: Ensure all players have 10 cards

6. **Create New Round**: Call `createActiveRound(nextJudge.profile_id)`
   - This sets the new judge and creates a new black card

## 🔄 Rotation Example

**Scenario**: 3 players join in order
- Player A joins first → player_order = 0
- Player B joins second → player_order = 1  
- Player C joins third → player_order = 2

**Round Progression**:
- **Round 1**: Player A is judge (player_order 0)
- **Round 2**: Player B is judge (player_order 1) ← (0 + 1) % 3 = 1
- **Round 3**: Player C is judge (player_order 2) ← (1 + 1) % 3 = 2
- **Round 4**: Player A is judge (player_order 0) ← (2 + 1) % 3 = 0 (wraps)

## 🔑 Key Points

1. **Player Order is Fixed**: Based on `joined_at` timestamp, never changes
2. **Judge Source of Truth**: `rounds.judge_profile_id` is the authoritative source
3. **Rotation Formula**: `(currentIndex + 1) % totalPlayers` ensures even rotation
4. **Synchronization**: `createActiveRound` updates both:
   - `room_players.is_judge` (for UI display)
   - `rounds.judge_profile_id` (for game logic)
5. **Always Changes**: The modulo operation ensures judge always rotates to next player

## 🐛 Potential Issues & Solutions

### Issue: Judge doesn't rotate
**Cause**: `currentRound` state might be stale
**Solution**: Query database directly for most recent round's judge

### Issue: Same judge twice
**Cause**: Player order calculation wrong
**Solution**: Always use `joined_at` order, verify with modulo check

### Issue: Judge mismatch (UI vs database)
**Cause**: `is_judge` flag out of sync with `rounds.judge_profile_id`
**Solution**: `createActiveRound` updates both simultaneously

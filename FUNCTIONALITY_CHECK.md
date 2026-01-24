# Judge Selection Functionality Check

## ✅ FIXES APPLIED

### ✅ Fix #1: Removed `.single()` that would fail if no rounds exist
**Status**: FIXED

**Changed**: Now uses `currentRound` from state first (most reliable), then falls back to database query without `.single()`

**Before**:
```javascript
.single();  // Would throw error if no rounds
```

**After**:
```javascript
// First try currentRound from state
if (currentRound && currentRound.judge_profile_id) {
  currentJudgeProfileId = currentRound.judge_profile_id;
} else {
  // Fallback: query without .single()
  const { data: recentRounds } = await supabase...
  if (recentRounds && recentRounds.length > 0) {
    currentJudgeProfileId = recentRounds[0].judge_profile_id;
  }
}
```

### ✅ Fix #2: Improved card replenishment to prevent duplicates
**Status**: FIXED

**Changed**: Now checks which cards are already in player's hand before adding new ones

**Before**: Could add duplicate cards
**After**: Filters out cards already in hand before selecting new ones

---

## 🔍 Issues Found (Remaining)

**Location**: `nextRound()` function, line 593

```javascript
const { data: recentRound, error: roundError } = await supabase
  .from("rounds")
  .select("judge_profile_id, id")
  .eq("room_id", roomId)
  .order("id", { ascending: false })
  .limit(1)
  .single();  // ← This will throw an error if no rounds exist
```

**Problem**: If this is the very first round after game start, or if there's a database issue, `.single()` will throw an error when no rows are found.

**Fix**: Remove `.single()` and handle the case where no rounds exist:

```javascript
const { data: recentRounds, error: roundError } = await supabase
  .from("rounds")
  .select("judge_profile_id, id")
  .eq("room_id", roomId)
  .order("id", { ascending: false })
  .limit(1);

let currentJudgeProfileId = null;
if (!roundError && recentRounds && recentRounds.length > 0) {
  currentJudgeProfileId = recentRounds[0].judge_profile_id;
}
```

### ⚠️ Issue #2: Race condition with round completion

**Location**: `selectWinner()` → `nextRound()` flow

**Problem**: 
1. `selectWinner()` marks round as "completed"
2. Immediately calls `nextRound()` after 3 seconds
3. `nextRound()` queries for most recent round
4. If the round update hasn't committed yet, it might get the wrong round

**Current Flow**:
```
selectWinner():
  1. Award point
  2. Update round status to "completed"  ← Database write
  3. Wait 3 seconds
  4. Call nextRound()  ← Might query before write is committed
```

**Fix**: Query should filter for completed rounds OR use the `currentRound` from state:

```javascript
// Option 1: Use currentRound from state (already has the completed round)
if (currentRound && currentRound.status === "completed") {
  currentJudgeProfileId = currentRound.judge_profile_id;
}

// Option 2: Query for most recent completed round
const { data: completedRound } = await supabase
  .from("rounds")
  .select("judge_profile_id")
  .eq("room_id", roomId)
  .eq("status", "completed")
  .order("id", { ascending: false })
  .limit(1)
  .single();
```

### ⚠️ Issue #3: Card replenishment might give duplicates

**Location**: `nextRound()` function, lines 682-707

**Problem**: The card replenishment logic doesn't check if a card is already in a player's hand. It just counts total cards and adds more. This could lead to duplicate cards if the same card is selected multiple times.

**Current Logic**:
```javascript
const cardsNeeded = 10 - (currentCards?.length || 0);
// Then selects random cards without checking if they're already in hand
```

**Fix**: Should track which cards have been dealt and avoid duplicates, OR use a more sophisticated shuffling system.

### ⚠️ Issue #4: No error recovery for failed judge rotation

**Location**: `nextRound()` function

**Problem**: If `createActiveRound()` fails, the game is left in a broken state with no active round and no judge.

**Fix**: Add retry logic or fallback to previous judge.

### ⚠️ Issue #5: `loadGameData()` might overwrite state

**Location**: Multiple places where `loadGameData()` is called

**Problem**: `loadGameData()` polls the database and might overwrite state that was just set. For example:
1. `nextRound()` sets `setCurrentRound(fullRound)`
2. Immediately calls `loadGameData()`
3. `loadGameData()` might query and get a different result, overwriting the state

**Fix**: Ensure `loadGameData()` doesn't clear state unnecessarily, or add a flag to prevent overwriting.

## ✅ What's Working Correctly

1. **Judge flag synchronization**: `createActiveRound()` correctly updates both `room_players.is_judge` and `rounds.judge_profile_id`
2. **Player order**: Using `joined_at` for consistent ordering is correct
3. **Rotation formula**: `(currentIndex + 1) % totalPlayers` is mathematically correct
4. **Point awarding**: Score update with verification is good
5. **Error handling**: Most functions have try-catch blocks

## 🔧 Recommended Fixes

### Priority 1: Fix `.single()` issue
This will cause crashes when no rounds exist.

### Priority 2: Fix race condition
Use `currentRound` from state instead of querying database in `nextRound()`.

### Priority 3: Improve card replenishment
Track dealt cards to prevent duplicates.

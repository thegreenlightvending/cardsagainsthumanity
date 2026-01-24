import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";

/**
 * GamePage - Cards Against Humanity Game Room
 * 
 * CARDS AGAINST HUMANITY RULES:
 * - 10 cards per player at start
 * - Judge rotates through players in join order (P1 → P2 → P3 → P1...)
 * - Winner gets 1 point per round (infinite scoring)
 * - Cards replenished to 10 after each round
 * - Only one active round per room at a time
 */
export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Game State
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [currentRound, setCurrentRound] = useState(null);
  const [playerHand, setPlayerHand] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");

  // UI State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Polling for real-time updates (every 2 seconds)
  useEffect(() => {
    if (!roomId || !user) return;
    
    loadGameData();
    const interval = setInterval(loadGameData, 2000);
    return () => clearInterval(interval);
  }, [roomId, user]);

  /**
   * Load all game data from database
   * Single source of truth - always reads from DB
   */
  async function loadGameData() {
    try {
      // Load room
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("*, decks(name, type)")
        .eq("id", roomId)
        .single();
      
      if (roomError) {
        console.error("Room load error:", roomError);
        setError("Room not found");
        setLoading(false);
        return;
      }
      
      if (roomData) setRoom(roomData);

      // Load players (ordered by join time - this is player_order for judge rotation)
      const { data: playersData } = await supabase
        .from("room_players")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (playersData) setPlayers(playersData);

      // If game is playing, load active round (only one submitting round per room)
      if (roomData?.status === "playing") {
        const { data: roundData, error: roundError } = await supabase
          .from("rounds")
          .select(`
            *,
            black_cards(text),
            profiles!judge_profile_id(username)
          `)
          .eq("room_id", roomId)
          .eq("status", "submitting")
          .order("id", { ascending: false })
          .limit(1);
        
        if (roundError) {
          console.error("Round load error:", roundError);
        } else if (roundData && roundData.length > 0) {
          setCurrentRound(roundData[0]);
          
          // Load submissions for this round
          const { data: submissionsData, error: submissionsError } = await supabase
            .from("submissions")
            .select("*, white_cards(text), profiles(username)")
            .eq("round_id", roundData[0].id);
          
          if (submissionsError) {
            console.error("Submissions load error:", submissionsError);
            setSubmissions([]);
          } else if (submissionsData) {
            setSubmissions(submissionsData);
          }
        } else {
          // No active round - clear round state
          setCurrentRound(null);
          setSubmissions([]);
        }

        // Load player's hand
        const { data: handData } = await supabase
          .from("player_hands")
          .select("*, white_cards(text)")
          .eq("room_id", roomId)
          .eq("profile_id", user.id);
        
        if (handData) setPlayerHand(handData);
      } else {
        // Game not playing - clear all game state
        setCurrentRound(null);
        setPlayerHand([]);
        setSubmissions([]);
      }

      // Load messages
      const { data: messagesData } = await supabase
        .from("messages")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(20);
      
      if (messagesData) setMessages(messagesData.reverse());

      setLoading(false);
    } catch (err) {
      console.error("Load error:", err);
      setError("Failed to load game data");
      setLoading(false);
    }
  }

  /**
   * Start the game
   * - Set room to "playing"
   * - Reset all scores to 0
   * - Deal 10 cards to each player
   * - Create first round with first player (by join order) as judge
   */
  async function startGame() {
    try {
      if (players.length < 3) {
        setError("Need at least 3 players to start");
        return;
      }

      setError("Starting game...");

      // 1. Set room to playing
      await supabase.from("rooms").update({ status: "playing" }).eq("id", roomId);

      // 2. Reset all scores to 0
      await supabase.from("room_players").update({ score: 0 }).eq("room_id", roomId);

      // 3. Clear existing hands
      await supabase.from("player_hands").delete().eq("room_id", roomId);

      // 4. Deal 10 cards to each player
      const { data: whiteCards } = await supabase
        .from("white_cards")
        .select("id")
        .eq("deck_id", room.deck_id);
      
      if (!whiteCards || whiteCards.length < players.length * 10) {
        throw new Error("Not enough cards in deck");
      }
      
      const shuffled = [...whiteCards].sort(() => Math.random() - 0.5);
      const hands = [];
      let cardIndex = 0;
      
      for (const player of players) {
        for (let i = 0; i < 10; i++) {
          hands.push({
            room_id: roomId,
            profile_id: player.profile_id,
            white_card_id: shuffled[cardIndex].id
          });
          cardIndex++;
        }
      }
      
      await supabase.from("player_hands").insert(hands);

      // 5. Create first round with first player (by join order) as judge
      await createActiveRound(players[0].profile_id);

      // 6. Refresh game data
      await loadGameData();
      setError("");

    } catch (err) {
      console.error("Start game error:", err);
      setError("Failed to start game: " + err.message);
    }
  }

  /**
   * Create an active round with a new judge
   * - Checks if active round already exists (prevents duplicates)
   * - Removes judge status from all players
   * - Sets new judge in room_players
   * - Gets random black card
   * - Creates round with status "submitting"
   * - Gracefully handles race conditions (if another client already created the round)
   */
  async function createActiveRound(judgeProfileId) {
    console.log("=== CREATE ACTIVE ROUND ===");
    console.log("Setting judge to:", judgeProfileId);
    
    // Guard: Check if active round already exists (prevents duplicate rounds)
    const { data: existingActive } = await supabase
      .from("rounds")
      .select("id, judge_profile_id")
      .eq("room_id", roomId)
      .eq("status", "submitting")
      .limit(1);
    
    if (existingActive && existingActive.length > 0) {
      // Active round already exists - just refresh
      console.log("Active round already exists, skipping creation");
      await loadGameData();
      return null;
    }

    // Remove judge status from all players
    const { error: removeError } = await supabase
      .from("room_players")
      .update({ is_judge: false })
      .eq("room_id", roomId);
    
    if (removeError) {
      console.error("Error removing judge flags:", removeError);
    }

    // Set new judge
    const { error: setJudgeError } = await supabase
      .from("room_players")
      .update({ is_judge: true })
      .eq("room_id", roomId)
      .eq("profile_id", judgeProfileId);
    
    if (setJudgeError) {
      console.error("Error setting judge:", setJudgeError);
      throw new Error("Failed to set judge: " + setJudgeError.message);
    }

    // Verify judge was set
    const { data: verifyJudge } = await supabase
      .from("room_players")
      .select("profile_id, is_judge, profiles(username)")
      .eq("room_id", roomId)
      .eq("profile_id", judgeProfileId)
      .single();
    
    console.log("Judge verification:", verifyJudge);
    if (!verifyJudge?.is_judge) {
      throw new Error("Failed to verify judge was set");
    }

    // Get random black card
    const { data: blackCards, error: blackCardsError } = await supabase
      .from("black_cards")
      .select("id, text")
      .eq("deck_id", room.deck_id);
    
    if (blackCardsError) {
      throw new Error("Failed to fetch black cards: " + blackCardsError.message);
    }
    
    if (!blackCards || blackCards.length === 0) {
      throw new Error("No black cards found in deck");
    }
    
    const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];

    // Create round - handle unique constraint violation gracefully (race condition)
    const { data: newRound, error } = await supabase
      .from("rounds")
      .insert({
        room_id: roomId,
        black_card_id: randomBlackCard.id,
        judge_profile_id: judgeProfileId,
        status: "submitting"
      })
      .select();
    
    if (error) {
      // If unique constraint violation, another client already created the round
      // Check for ANY duplicate key error (multiple ways it can be expressed)
      const isDuplicateError = 
        error.code === '23505' || 
        error.code === 'PGRST116' ||
        error.message?.includes('rounds_one_submitting_per_room') ||
        error.message?.includes('duplicate key') ||
        error.message?.includes('unique constraint');
      
      if (isDuplicateError) {
        console.log("Round already exists (race condition) - refreshing data");
        console.log("Error details:", error.code, error.message);
        // Just refresh - the round already exists
        await loadGameData();
        return null;
      }
      
      // For any other error, throw it
      console.error("Failed to create round:", error);
      throw new Error("Failed to create round: " + error.message);
    }
    
    console.log("Round created successfully:", {
      round_id: newRound[0]?.id,
      judge_id: newRound[0]?.judge_profile_id,
      judge_name: verifyJudge?.profiles?.username
    });
    console.log("=== END CREATE ACTIVE ROUND ===");
    
    return newRound[0];
  }

  /**
   * Submit a white card
   */
  async function submitCard(cardId) {
    try {
      if (!currentRound) {
        setError("No active round");
        return;
      }

      // Check if already submitted
      const { data: existing } = await supabase
        .from("submissions")
        .select("id")
        .eq("round_id", currentRound.id)
        .eq("profile_id", user.id)
        .limit(1);
      
      if (existing && existing.length > 0) {
        setError("You already submitted a card");
        return;
      }

      // Submit card
      const { error: submitError } = await supabase
        .from("submissions")
        .insert({
          round_id: currentRound.id,
          profile_id: user.id,
          white_card_id: cardId
        });

      if (submitError) {
        throw submitError;
      }

      // Remove card from hand
      await supabase
        .from("player_hands")
        .delete()
        .eq("profile_id", user.id)
        .eq("white_card_id", cardId)
        .eq("room_id", roomId);

      // Refresh data
      await loadGameData();
      setError("Card submitted!");

    } catch (err) {
      console.error("Submit error:", err);
      setError("Failed to submit card: " + err.message);
    }
  }

  /**
   * Judge selects winner
   * - Awards 1 point to winner
   * - Marks round as completed
   * - Automatically starts next round after 2 seconds
   */
  async function selectWinner(submissionId) {
    try {
      // Verify user is the judge
      if (currentRound?.judge_profile_id !== user.id) {
        setError("Only the judge can select a winner");
        return;
      }

      // Get submission to find winner
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("profile_id, white_cards(text)")
        .eq("id", submissionId)
        .single();

      if (submissionError || !submission) {
        throw new Error("Submission not found");
      }

      // Get winner's current score
      const { data: winnerData } = await supabase
        .from("room_players")
        .select("score, profiles(username)")
        .eq("room_id", roomId)
        .eq("profile_id", submission.profile_id)
        .limit(1);
      
      if (!winnerData || winnerData.length === 0) {
        throw new Error("Winner not found");
      }

      const winner = winnerData[0];
      const newScore = (winner.score || 0) + 1;

      // Award point to winner
      await supabase
        .from("room_players")
        .update({ score: newScore })
        .eq("room_id", roomId)
        .eq("profile_id", submission.profile_id);

      // Mark round as completed - verify it actually updated
      const { error: roundUpdateError } = await supabase
        .from("rounds")
        .update({
          winner_profile_id: submission.profile_id,
          status: "completed"
        })
        .eq("id", currentRound.id)
        .eq("status", "submitting"); // Only update if still submitting (prevents double-updates)

      if (roundUpdateError) {
        throw new Error("Failed to complete round: " + roundUpdateError.message);
      }

      // Verify the round was actually marked as completed
      const { data: verifyRound } = await supabase
        .from("rounds")
        .select("status")
        .eq("id", currentRound.id)
        .single();

      if (verifyRound?.status !== "completed") {
        throw new Error("Round was not properly marked as completed");
      }

      // Refresh players to show updated score
      const { data: refreshedPlayers } = await supabase
        .from("room_players")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (refreshedPlayers) {
        setPlayers(refreshedPlayers);
      }

      // Clear current round state (it's now completed)
      setCurrentRound(null);
      setSubmissions([]);

      setError(`Winner selected! +1 point to ${winner.profiles?.username || "winner"}. Starting next round...`);

      // Automatically start next round after 2 seconds
      // Give database time to process the update
      setTimeout(async () => {
        try {
          await nextRound();
        } catch (err) {
          console.error("Error in nextRound:", err);
          setError("Failed to start next round: " + err.message);
        }
      }, 2000);

    } catch (err) {
      console.error("Select winner error:", err);
      setError("Failed to select winner: " + err.message);
    }
  }

  /**
   * Start next round
   * - Reads most recent completed round from DB (source of truth)
   * - Rotates judge to next player in join order
   * - Replenishes cards to 10 per player
   * - Creates new round with new judge
   */
  async function nextRound() {
    try {
      // Guard: Check if active round already exists (prevents duplicate rounds)
      // Double-check to ensure no submitting rounds exist
      const { data: activeRoundsNow, error: activeCheckError } = await supabase
        .from("rounds")
        .select("id, status")
        .eq("room_id", roomId)
        .eq("status", "submitting");
      
      if (activeCheckError) {
        console.error("Error checking active rounds:", activeCheckError);
      }
      
      if (activeRoundsNow && activeRoundsNow.length > 0) {
        // Active round already exists - just refresh
        console.log("Active round already exists, refreshing data");
        await loadGameData();
        return;
      }

      // Source of truth: Get most recent COMPLETED round from DB
      // CRITICAL: Get ALL completed rounds to see the full history
      const { data: allCompletedRounds, error: lastCompletedRoundError } = await supabase
        .from("rounds")
        .select("judge_profile_id, id, status")
        .eq("room_id", roomId)
        .eq("status", "completed")
        .order("id", { ascending: false })
        .limit(5); // Get last 5 completed rounds for debugging

      if (lastCompletedRoundError) {
        throw new Error("Failed to read last completed round: " + lastCompletedRoundError.message);
      }

      console.log("=== JUDGE ROTATION DEBUG ===");
      console.log("All completed rounds:", allCompletedRounds?.map(r => ({
        id: r.id,
        judge: r.judge_profile_id,
        status: r.status
      })));

      const completedRoundJudgeId = allCompletedRounds?.[0]?.judge_profile_id;

      if (!completedRoundJudgeId) {
        throw new Error("Could not determine previous judge for rotation.");
      }

      console.log("Using most recent completed round judge ID:", completedRoundJudgeId);

      // Get all players in join order (this is player_order for judge rotation)
      const { data: allPlayers } = await supabase
        .from("room_players")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (!allPlayers || allPlayers.length === 0) {
        throw new Error("No players found");
      }

      console.log("All players (in join order):", allPlayers.map((p, i) => ({
        index: i,
        name: p.profiles?.username,
        id: p.profile_id,
        joined_at: p.joined_at
      })));

      // Find current judge's index in the ordered list
      const currentJudgeIndex = allPlayers.findIndex(
        p => p.profile_id === completedRoundJudgeId
      );

      console.log("Current judge index:", currentJudgeIndex);
      console.log("Current judge:", allPlayers[currentJudgeIndex]?.profiles?.username);
      console.log("Total players:", allPlayers.length);

      if (currentJudgeIndex === -1) {
        throw new Error("Current judge not found in players list");
      }

      // Calculate next judge (rotate through players, loop back to first)
      const nextJudgeIndex = (currentJudgeIndex + 1) % allPlayers.length;
      const nextJudge = allPlayers[nextJudgeIndex];

      console.log("=== ROTATION CALCULATION ===");
      console.log("Current judge index:", currentJudgeIndex, "(" + allPlayers[currentJudgeIndex]?.profiles?.username + ")");
      console.log("Total players:", allPlayers.length);
      console.log("Calculation:", `${currentJudgeIndex} + 1 = ${currentJudgeIndex + 1}`);
      console.log("Modulo:", `${currentJudgeIndex + 1} % ${allPlayers.length} = ${nextJudgeIndex}`);
      console.log("Next judge index:", nextJudgeIndex);
      console.log("Next judge name:", nextJudge.profiles?.username);
      console.log("Next judge ID:", nextJudge.profile_id);
      console.log("Current judge ID:", completedRoundJudgeId);
      console.log("Are they different?", nextJudge.profile_id !== completedRoundJudgeId);
      console.log("=== END ROTATION CALCULATION ===");

      // CRITICAL: Verify the next judge is actually different
      if (nextJudge.profile_id === completedRoundJudgeId) {
        console.error("❌ ROTATION FAILED: Next judge is same as current judge!");
        console.error("Current:", completedRoundJudgeId, allPlayers[currentJudgeIndex]?.profiles?.username);
        console.error("Next:", nextJudge.profile_id, nextJudge.profiles?.username);
        throw new Error(`Judge rotation failed: Next judge is same as current judge! Current: ${completedRoundJudgeId}, Next: ${nextJudge.profile_id}`);
      }

      console.log("✅ Rotation verified: Judge will change from", allPlayers[currentJudgeIndex]?.profiles?.username, "→", nextJudge.profiles?.username);

      // Replenish cards to 10 per player
      for (const player of allPlayers) {
        const { data: currentCards } = await supabase
          .from("player_hands")
          .select("white_card_id")
          .eq("room_id", roomId)
          .eq("profile_id", player.profile_id);
        
        const cardsNeeded = 10 - (currentCards?.length || 0);
        
        if (cardsNeeded > 0) {
          const { data: allDeckCards } = await supabase
            .from("white_cards")
            .select("id")
            .eq("deck_id", room.deck_id);
          
          if (allDeckCards && allDeckCards.length > 0) {
            const cardsInHand = new Set((currentCards || []).map(c => c.white_card_id));
            const availableCards = allDeckCards.filter(card => !cardsInHand.has(card.id));
            const shuffled = [...availableCards].sort(() => Math.random() - 0.5);
            const cardsToAdd = shuffled.slice(0, Math.min(cardsNeeded, shuffled.length));
            
            if (cardsToAdd.length > 0) {
              // Insert cards, ignoring duplicates (prevents 409 errors)
              const cardsToInsert = cardsToAdd.map(card => ({
                room_id: roomId,
                profile_id: player.profile_id,
                white_card_id: card.id
              }));
              
              // Insert one at a time to handle duplicates gracefully
              for (const cardData of cardsToInsert) {
                const { error: insertError } = await supabase
                  .from("player_hands")
                  .insert(cardData);
                
                // Ignore duplicate key errors (card already in hand)
                if (insertError && insertError.code !== '23505' && insertError.code !== 'PGRST116') {
                  console.error("Error adding card to hand:", insertError);
                }
              }
            }
          }
        }
      }

      // Clear submissions state
      setSubmissions([]);

      // FORCE UPDATE: Remove all judge flags first
      await supabase
        .from("room_players")
        .update({ is_judge: false })
        .eq("room_id", roomId);
      
      // FORCE UPDATE: Set ONLY the next judge
      const { error: setJudgeError } = await supabase
        .from("room_players")
        .update({ is_judge: true })
        .eq("room_id", roomId)
        .eq("profile_id", nextJudge.profile_id);
      
      if (setJudgeError) {
        console.error("CRITICAL: Failed to set judge flag:", setJudgeError);
        throw new Error("Failed to set judge: " + setJudgeError.message);
      }
      
      console.log("✅ FORCED judge flag update:", nextJudge.profiles?.username, nextJudge.profile_id);

      // Create new round with new judge
      const newRound = await createActiveRound(nextJudge.profile_id);

      // If newRound is null, it means another client already created it (race condition)
      // Just refresh data - loadGameData will pick up the existing round
      if (!newRound) {
        await loadGameData();
        return;
      }

      // CRITICAL: FORCE the judge in the round record
      if (newRound.judge_profile_id !== nextJudge.profile_id) {
        console.error("❌ JUDGE MISMATCH! Round has wrong judge, FORCING update...");
        const { error: forceError } = await supabase
          .from("rounds")
          .update({ judge_profile_id: nextJudge.profile_id })
          .eq("id", newRound.id);
        
        if (forceError) {
          console.error("CRITICAL: Failed to force judge update:", forceError);
          throw new Error("Failed to update judge in round: " + forceError.message);
        }
        
        newRound.judge_profile_id = nextJudge.profile_id;
        console.log("✅ FORCED judge update in round record");
      }

      console.log("=== FINAL VERIFICATION ===");
      console.log("Round ID:", newRound.id);
      console.log("Expected judge:", nextJudge.profile_id, nextJudge.profiles?.username);
      console.log("Round judge_profile_id:", newRound.judge_profile_id);
      console.log("Match:", newRound.judge_profile_id === nextJudge.profile_id);
      console.log("=== END VERIFICATION ===");

      // Get black card text
      const { data: blackCard } = await supabase
        .from("black_cards")
        .select("text")
        .eq("id", newRound.black_card_id)
        .single();

      // FORCE set the current round state with correct judge
      const forcedRound = {
        ...newRound,
        black_cards: { text: blackCard?.text || "Loading..." },
        profiles: { username: nextJudge.profiles?.username }
      };
      
      setCurrentRound(forcedRound);
      console.log("✅ FORCED currentRound state with judge:", nextJudge.profiles?.username);

      // FORCE update players list with correct judge flag
      const { data: refreshedPlayers } = await supabase
        .from("room_players")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (refreshedPlayers) {
        // Ensure only the correct player has is_judge = true
        const updatedPlayers = refreshedPlayers.map(p => ({
          ...p,
          is_judge: p.profile_id === nextJudge.profile_id
        }));
        setPlayers(updatedPlayers);
        console.log("✅ FORCED players list update");
      }

      // Clear submissions for new round
      setSubmissions([]);

      setError(`New round! ${nextJudge.profiles?.username} is now the judge.`);
      setTimeout(() => setError(""), 4000);

    } catch (err) {
      console.error("Next round error:", err);
      setError("Failed to start next round: " + err.message);
    }
  }

  /**
   * Send chat message
   */
  async function sendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      await supabase.from("messages").insert({
        room_id: roomId,
        profile_id: user.id,
        content: newMessage.trim()
      });

      setNewMessage("");
      await loadGameData();
    } catch (err) {
      console.error("Message error:", err);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-xl">Loading game...</div>
      </div>
    );
  }

  // Room not found
  if (!room) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl mb-4">Room not found</h1>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  // Calculate derived state
  const isHost = room.party_leader === user.id;
  const isJudge = currentRound?.judge_profile_id === user.id;
  const hasSubmitted = submissions.some(s => s.profile_id === user.id);
  const nonJudgeCount = players.filter(p => 
    currentRound ? currentRound.judge_profile_id !== p.profile_id : !p.is_judge
  ).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="bg-zinc-900 p-4 border-b border-zinc-800">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">Cards Against Humanity</h1>
            <p className="text-sm text-zinc-400">
              {room.decks?.name} • {players.length} players • Status: {room.status}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadGameData}
              className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500"
            >
              Refresh
            </button>
            <button
              onClick={() => navigate("/")}
              className="px-3 py-1 bg-red-600 rounded hover:bg-red-500"
            >
              Leave
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Players List */}
        <div className="lg:col-span-1">
          <div className="bg-zinc-900 rounded-lg p-4">
            <h2 className="font-bold mb-3 text-lg">Players ({players.length})</h2>
            <div className="space-y-2">
              {players.map((player) => {
                const isPlayerJudge = currentRound?.judge_profile_id === player.profile_id;
                const isPlayerHost = player.profile_id === room.party_leader;
                
                return (
                  <div
                    key={`${player.profile_id}-${isPlayerJudge}-${player.score}`}
                    className={`p-3 rounded-lg border transition-all ${
                      isPlayerJudge
                        ? "bg-purple-900/30 border-purple-600 shadow-lg shadow-purple-500/20"
                        : "bg-zinc-800 border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">
                          {player.profiles?.username || "Unknown"}
                        </span>
                        {isPlayerJudge && (
                          <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded font-bold animate-pulse">
                            ⚖️ JUDGE
                          </span>
                        )}
                        {isPlayerHost && (
                          <span className="text-xs bg-yellow-600 text-white px-2 py-0.5 rounded">
                            👑 HOST
                          </span>
                        )}
                      </div>
                      <span className={`text-sm font-semibold ${isPlayerJudge ? "text-purple-300" : "text-zinc-300"}`}>
                        {player.score || 0} pts
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div className="lg:col-span-2">
          <div className="bg-zinc-900 rounded-lg p-6">
            {room.status === "waiting" ? (
              <div className="text-center py-12">
                <h2 className="text-2xl font-bold mb-4">Waiting for Game</h2>
                <p className="text-zinc-400 mb-6">Need at least 3 players to start</p>
                {isHost && (
                  <button
                    onClick={startGame}
                    disabled={players.length < 3}
                    className={`px-6 py-3 rounded-lg font-bold ${
                      players.length >= 3
                        ? "bg-green-600 hover:bg-green-500"
                        : "bg-gray-600 cursor-not-allowed opacity-50"
                    }`}
                  >
                    {players.length >= 3 ? "Start Game" : `Need ${3 - players.length} more players`}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Black Card */}
                <div className="text-center">
                  <div className="bg-black rounded-lg p-8 mb-4 border-2 border-white">
                    <h3 className="text-2xl font-bold mb-4 text-white">Black Card</h3>
                    <p className="text-2xl text-white mb-4">
                      {currentRound?.black_cards?.text || "Loading..."}
                    </p>
                    <p className="text-lg text-purple-300 font-semibold">
                      ⚖️ Judge: {currentRound?.profiles?.username || "Judge"}
                    </p>
                  </div>
                  
                  {/* Game Status */}
                  <div className="bg-zinc-800 rounded-lg p-4">
                    <p className="text-lg text-zinc-300">
                      Cards Submitted: {submissions.length} / {nonJudgeCount}
                    </p>
                    {submissions.length === nonJudgeCount && nonJudgeCount > 0 && (
                      <p className="text-yellow-400 mt-2">Judge is choosing winner!</p>
                    )}
                  </div>
                </div>

                {/* Player's Hand */}
                <div className="bg-zinc-800 rounded-lg p-4">
                  {playerHand.length > 0 ? (
                    <>
                      <h3 className="text-xl font-bold mb-4 text-center">
                        Your Cards ({playerHand.length}/10)
                        {isJudge && <span className="text-purple-400 ml-2">(You are the Judge)</span>}
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        {playerHand.map((card) => (
                          <button
                            key={card.id}
                            onClick={() => !isJudge && submitCard(card.white_card_id)}
                            disabled={isJudge || hasSubmitted}
                            className={`p-4 rounded-lg text-sm font-medium transition-all ${
                              isJudge
                                ? "bg-gray-600 text-gray-300 cursor-not-allowed"
                                : hasSubmitted
                                ? "bg-green-200 text-green-800 cursor-not-allowed"
                                : "bg-white text-black hover:bg-yellow-100 hover:scale-105 shadow-lg"
                            }`}
                          >
                            {card.white_cards?.text}
                          </button>
                        ))}
                      </div>
                      {hasSubmitted && !isJudge && (
                        <p className="text-green-400 text-center mt-4 text-lg font-bold">
                          ✓ Card Submitted!
                        </p>
                      )}
                      {isJudge && (
                        <p className="text-purple-400 text-center mt-4 text-lg">
                          You are judging this round - wait for submissions
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-zinc-400 text-lg">No cards in hand</p>
                    </div>
                  )}
                </div>

                {/* Judge's Submission View */}
                {isJudge && currentRound && (
                  <div className="bg-purple-900/30 border-2 border-purple-600 rounded-lg p-6">
                    <div className="text-center mb-4">
                      <h3 className="text-2xl font-bold text-purple-200 mb-2">
                        ⚖️ Judge's Choice
                      </h3>
                      <p className="text-purple-300">
                        Submitted Cards: <span className="font-bold text-white">{submissions.length} / {nonJudgeCount}</span>
                      </p>
                    </div>
                    {submissions.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-purple-300 text-lg">Waiting for players to submit cards...</p>
                      </div>
                    ) : (
                      <div>
                        {submissions.length < nonJudgeCount && (
                          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 mb-4 text-center">
                            <p className="text-yellow-300 font-semibold">
                              ⏳ {nonJudgeCount - submissions.length} more card(s) coming...
                            </p>
                          </div>
                        )}
                        {submissions.length === nonJudgeCount && (
                          <div className="bg-green-900/30 border-2 border-green-500 rounded-lg p-4 mb-4 text-center">
                            <p className="text-green-300 font-bold text-xl">✓ All cards submitted!</p>
                            <p className="text-green-200 text-lg mt-1">Click on your favorite card to choose the winner:</p>
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-4">
                          {submissions.map((submission, index) => (
                            <button
                              key={submission.id}
                              onClick={() => selectWinner(submission.id)}
                              className="bg-white text-black p-5 rounded-lg text-left hover:bg-yellow-100 hover:scale-105 border-2 border-transparent hover:border-yellow-500 transition-all shadow-lg hover:shadow-xl cursor-pointer"
                            >
                              <div className="flex justify-between items-start mb-2">
                                <div className="font-bold text-sm text-purple-600 bg-purple-100 px-2 py-1 rounded">
                                  Card #{index + 1}
                                </div>
                                <div className="text-xs text-zinc-500">Click to select winner</div>
                              </div>
                              <div className="text-lg font-medium">{submission.white_cards?.text}</div>
                              {submission.profiles && (
                                <div className="text-xs text-zinc-500 mt-2">
                                  Submitted by: {submission.profiles.username}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Chat */}
        <div className="lg:col-span-1">
          <div className="bg-zinc-900 rounded-lg p-4 h-96 flex flex-col">
            <h2 className="font-bold mb-3">Chat</h2>
            <div className="flex-1 overflow-y-auto space-y-2 mb-3">
              {messages.map((msg) => (
                <div key={msg.id} className="text-sm">
                  <span className="font-medium text-zinc-300">{msg.profiles?.username}:</span>
                  <span className="ml-2">{msg.content}</span>
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type message..."
                className="flex-1 bg-zinc-800 rounded px-2 py-1 text-sm"
              />
              <button
                type="submit"
                className="px-3 py-1 bg-blue-600 rounded text-sm hover:bg-blue-500"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-900 border border-red-700 rounded-lg px-4 py-2 text-red-200 max-w-md">
          {error}
        </div>
      )}
    </div>
  );
}

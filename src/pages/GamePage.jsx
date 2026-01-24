import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";

/*
 * ACTIVE ROUND DEFINITION:
 * - START: When a black card is dealt (status: "submitting")
 * - END: When judge picks winning card (status: "completed")
 * 
 * Only one round can be active at a time per room.
 * Players submit cards during active rounds (status: "submitting").
 * Judge picks winner to end the active round.
 */

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Game state
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [currentRound, setCurrentRound] = useState(null);
  const [hasActiveRound, setHasActiveRound] = useState(false);
  const [playerHand, setPlayerHand] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Remove unused gamePhase state

  useEffect(() => {
    if (!roomId || !user) return;
    
    loadGameData();
    
    // Simple polling every 2 seconds
    const interval = setInterval(loadGameData, 2000);
    return () => clearInterval(interval);
  }, [roomId, user]);

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
        setError("Room not found or access denied");
        setLoading(false);
        return;
      }
      
      if (roomData) setRoom(roomData);

      // Load players
      const { data: playersData } = await supabase
        .from("room_players")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at");
      
      if (playersData) setPlayers(playersData);

      // If game is playing, load game data
      if (roomData?.status === "playing") {
        // Load ACTIVE round with black card text
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
        }
        
        // Determine which round to use (from query or current state)
        let activeRound = null;
        if (roundData && roundData.length > 0) {
          activeRound = roundData[0];
          setCurrentRound(activeRound);
          setHasActiveRound(true);
        } else if (currentRound && hasActiveRound) {
          // Use existing currentRound if it exists and hasActiveRound is true
          activeRound = currentRound;
        } else {
          // If room is not playing, clear everything
          if (roomData?.status !== "playing") {
            setCurrentRound(null);
            setHasActiveRound(false);
          } else {
            // Room is playing but no round found
            // If hasActiveRound is true, keep it (round might be loading)
            // If hasActiveRound is false, clear currentRound
            if (!hasActiveRound) {
              setCurrentRound(null);
            }
            // If hasActiveRound is true, don't clear currentRound (it might be set by startGame)
          }
        }
        
        // Load player hand
        const { data: handData } = await supabase
          .from("player_hands")
          .select("*, white_cards(text)")
          .eq("room_id", roomId)
          .eq("profile_id", user.id);
        
        if (handData) setPlayerHand(handData);

        // Load submissions - use activeRound if available
        const roundIdForSubmissions = activeRound?.id || (hasActiveRound && currentRound?.id ? currentRound.id : null);
        
        if (roundIdForSubmissions) {
          console.log("Loading submissions for round:", roundIdForSubmissions, "isJudge:", players.find(p => p.profile_id === user.id)?.is_judge);
          const { data: submissionsData, error: submissionsError } = await supabase
            .from("submissions")
            .select("*, white_cards(text), profiles(username)")
            .eq("round_id", roundIdForSubmissions);
          
          if (submissionsError) {
            console.error("Submissions load error:", submissionsError);
            setSubmissions([]);
          } else {
            console.log("Submissions loaded successfully:", {
              count: submissionsData?.length || 0,
              roundId: roundIdForSubmissions,
              submissions: submissionsData,
              isJudge: players.find(p => p.profile_id === user.id)?.is_judge
            });
            setSubmissions(submissionsData || []);
          }
        } else {
          // No active round, clear submissions
          console.log("No active round found, clearing submissions");
          setSubmissions([]);
        }
      } else {
        setCurrentRound(null);
        setHasActiveRound(false);
        setPlayerHand([]);
        setSubmissions([]);
      }

      // Load messages
      const { data: messagesData } = await supabase
        .from("messages")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("created_at")
        .limit(20);
      
      if (messagesData) setMessages(messagesData);

      setLoading(false);
    } catch (err) {
      console.error("Load error:", err);
      setError("Failed to load game data");
      setLoading(false);
    }
  }

  // SINGLE FUNCTION TO CREATE ACTIVE ROUNDS
  async function createActiveRound(judgeProfileId) {
    console.log("createActiveRound called with judge:", judgeProfileId);
    
    // STEP 1: Ensure room_players.is_judge flag matches the judge we're setting
    // Remove judge status from all players first
    const { error: removeJudgeError } = await supabase
      .from("room_players")
      .update({ is_judge: false })
      .eq("room_id", roomId);
    
    if (removeJudgeError) {
      console.error("Error removing judge status:", removeJudgeError);
      throw new Error("Failed to remove judge status: " + removeJudgeError.message);
    }
    
    // Set the new judge in room_players
    const { error: setJudgeError } = await supabase
      .from("room_players")
      .update({ is_judge: true })
      .eq("room_id", roomId)
      .eq("profile_id", judgeProfileId);
    
    if (setJudgeError) {
      console.error("Error setting judge status:", setJudgeError);
      throw new Error("Failed to set judge status: " + setJudgeError.message);
    }
    
    console.log("✓ Judge status updated in room_players for:", judgeProfileId);
    
    // STEP 2: Get random black card
    const { data: blackCards, error: blackCardsError } = await supabase
      .from("black_cards")
      .select("id, text")
      .eq("deck_id", room.deck_id);
    
    if (blackCardsError) {
      console.error("Error fetching black cards:", blackCardsError);
      throw new Error("Failed to fetch black cards: " + blackCardsError.message);
    }
    
    if (!blackCards || blackCards.length === 0) {
      throw new Error("No black cards found in deck");
    }
    
    const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];
    
    console.log("Selected random black card:", {
      id: randomBlackCard.id,
      text: randomBlackCard.text
    });
    
    // STEP 3: Create active round with new judge
    console.log("Creating new round:", {
      room_id: roomId,
      black_card_id: randomBlackCard.id,
      judge_profile_id: judgeProfileId
    });
    
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
      console.error("Round creation error:", error);
      throw new Error("Failed to create round: " + error.message);
    }
    
    if (!newRound || newRound.length === 0) {
      throw new Error("Round was not created");
    }
    
    console.log("✓ New round created successfully:", {
      round_id: newRound[0].id,
      judge_profile_id: judgeProfileId,
      black_card_id: randomBlackCard.id
    });
    
    // Set active round to true when black card is created
    setHasActiveRound(true);
    
    return newRound[0];
  }

  async function startGame() {
    try {
      setError("Starting game...");

      if (players.length < 3) {
        throw new Error("Need at least 3 players to start");
      }

      // 1. Set room to playing
      await supabase.from("rooms").update({ status: "playing" }).eq("id", roomId);

      // 2. Reset all scores to 0 for a fresh game
      await supabase.from("room_players").update({ score: 0 }).eq("room_id", roomId);
      console.log("Reset all player scores to 0");

      // 3. Judge will be set by createActiveRound() - no need to set it here
      // This ensures consistency between rounds.judge_profile_id and room_players.is_judge

      // 4. Deal 10 cards to each player
      await supabase.from("player_hands").delete().eq("room_id", roomId);
      
      const { data: whiteCards } = await supabase.from("white_cards").select("id").eq("deck_id", room.deck_id);
      if (!whiteCards || whiteCards.length < players.length * 10) {
        throw new Error("Not enough cards in deck");
      }
      
      const shuffled = [...whiteCards].sort(() => Math.random() - 0.5);
      const hands = [];
      let cardIndex = 0;
      
      for (let i = 0; i < players.length; i++) {
        for (let j = 0; j < 10; j++) {
          hands.push({
            room_id: roomId,
            profile_id: players[i].profile_id,
            white_card_id: shuffled[cardIndex].id
          });
          cardIndex++;
        }
      }
      await supabase.from("player_hands").insert(hands);

      // 5. CREATE ACTIVE ROUND
      const newRound = await createActiveRound(players[0].profile_id);

      // 6. Set active round to true
      setHasActiveRound(true);

      // 7. Update room status in state
      setRoom(prev => ({ ...prev, status: "playing" }));
      
      // 8. Load the round we just created with full details
      if (newRound && newRound.id) {
        // Get the full round with black card text
        const { data: fullRound, error: roundLoadError } = await supabase
          .from("rounds")
          .select(`
            *,
            black_cards(text),
            profiles!judge_profile_id(username)
          `)
          .eq("id", newRound.id)
          .single();
        
        if (roundLoadError) {
          console.error("Error loading round:", roundLoadError);
        }
        
        if (fullRound) {
          setCurrentRound(fullRound);
        } else {
          // If query fails, try to construct round from what we have
          const { data: blackCard } = await supabase
            .from("black_cards")
            .select("text")
            .eq("id", newRound.black_card_id)
            .single();
          
          if (blackCard) {
            setCurrentRound({
              ...newRound,
              black_cards: { text: blackCard.text },
              profiles: { username: players[0].profiles?.username }
            });
          }
        }
      }

      // 9. Refresh all game data
      await loadGameData();
      setError("");
      
    } catch (err) {
      console.error("Start game error:", err);
      setError("Failed to start: " + err.message);
    }
  }


  async function submitCard(cardId) {
    try {
      // If currentRound is null but hasActiveRound is true, try to fetch it
      let roundToUse = currentRound;
      
      if (!roundToUse && hasActiveRound && room?.status === "playing") {
        // Try to fetch the active round
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
          .limit(1)
          .single();
        
        if (roundError || !roundData) {
          setError("No active round found. Please wait for the round to start.");
          return;
        }
        
        roundToUse = roundData;
        setCurrentRound(roundData);
      }

      // Final check
      if (!roundToUse) {
        setError("No active round");
        return;
      }

      // Check if user already submitted for THIS round
      const { data: existingSubmissions, error: checkError } = await supabase
        .from("submissions")
        .select("id, white_card_id")
        .eq("round_id", roundToUse.id)
        .eq("profile_id", user.id)
        .limit(1);
      
      if (checkError) {
        console.error("Error checking existing submission:", checkError);
        // Don't block submission if check fails - let the insert handle duplicates
      } else if (existingSubmissions && existingSubmissions.length > 0) {
        console.warn("User already submitted for this round:", {
          round_id: roundToUse.id,
          existing_submission: existingSubmissions[0],
          attempted_card: cardId
        });
        setError("You already submitted a card for this round");
        return;
      }
      
      // Also check if this specific card was already submitted by this user in this round
      // (defense against double-clicks or race conditions)
      if (existingSubmissions && existingSubmissions.length > 0) {
        const existingCard = existingSubmissions.find(s => s.white_card_id === cardId);
        if (existingCard) {
          console.warn("This exact card was already submitted:", {
            card_id: cardId,
            submission_id: existingCard.id
          });
          setError("This card was already submitted");
          return;
        }
      }

      // Submit card
      console.log("Submitting card:", {
        round_id: roundToUse.id,
        profile_id: user.id,
        white_card_id: cardId
      });
      
      const { data: newSubmission, error: submitError } = await supabase
        .from("submissions")
        .insert({
          round_id: roundToUse.id,
          profile_id: user.id,
          white_card_id: cardId
        })
        .select();

      if (submitError) {
        console.error("Submission insert error:", submitError);
        throw submitError;
      }

      console.log("Submission created:", newSubmission);

      // Remove card from hand
      const { error: removeError } = await supabase
        .from("player_hands")
        .delete()
        .eq("profile_id", user.id)
        .eq("white_card_id", cardId)
        .eq("room_id", roomId);

      if (removeError) {
        console.error("Remove card error:", removeError);
        throw removeError;
      }

      // Refresh submissions immediately so judge sees the new card
      // IMPORTANT: Only load submissions for THIS specific round to prevent duplicates
      const { data: submissionsData, error: submissionsError } = await supabase
        .from("submissions")
        .select("*, white_cards(text), profiles(username)")
        .eq("round_id", roundToUse.id) // Only submissions for current round
        .order("created_at", { ascending: true }); // Order by submission time
      
      if (submissionsError) {
        console.error("Error refreshing submissions after submit:", submissionsError);
      } else {
        // Verify no duplicates (same user, same round, same card)
        const uniqueSubmissions = submissionsData?.filter((sub, index, self) => 
          index === self.findIndex(s => 
            s.id === sub.id && 
            s.profile_id === sub.profile_id && 
            s.round_id === sub.round_id
          )
        ) || [];
        
        if (uniqueSubmissions.length !== (submissionsData?.length || 0)) {
          console.warn("Duplicate submissions detected! Filtered:", {
            before: submissionsData?.length || 0,
            after: uniqueSubmissions.length
          });
        }
        
        console.log("Refreshed submissions after submit:", {
          count: uniqueSubmissions.length,
          round_id: roundToUse.id,
          submissions: uniqueSubmissions.map(s => ({
            id: s.id,
            profile: s.profiles?.username,
            card: s.white_cards?.text
          }))
        });
        setSubmissions(uniqueSubmissions);
      }

      // Refresh player hand
      await loadGameData();

      setError("Card submitted!");
      setTimeout(() => setError(""), 2000);
    } catch (err) {
      console.error("Submit error:", err);
      setError("Failed to submit card: " + err.message);
    }
  }

  async function selectWinner(submissionId) {
    try {
      console.log("Judge selecting winner, submission ID:", submissionId);
      
      // Get submission details - this tells us who submitted the winning card
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("profile_id, white_cards(text)")
        .eq("id", submissionId)
        .single();

      if (submissionError || !submission) {
        console.error("Error fetching submission:", submissionError);
        throw new Error("Submission not found: " + (submissionError?.message || "Unknown error"));
      }

      console.log("Winner submission found:", {
        profile_id: submission.profile_id,
        card_text: submission.white_cards?.text
      });

      // STEP 1: Award point to the winner FIRST (before ending round)
      // Don't use .single() with joins - handle as array
      const { data: currentPlayers, error: scoreQueryError } = await supabase
        .from("room_players")
        .select("score, profiles(username)")
        .eq("room_id", roomId)
        .eq("profile_id", submission.profile_id)
        .limit(1);
      
      if (scoreQueryError) {
        console.error("Error fetching current score:", scoreQueryError);
        throw new Error("Failed to fetch winner's score: " + scoreQueryError.message);
      }
      
      if (!currentPlayers || currentPlayers.length === 0) {
        throw new Error("Player not found in room");
      }
      
      const currentPlayer = currentPlayers[0];
      const currentScore = currentPlayer?.score || 0;
      const newScore = currentScore + 1;
      
      console.log("Awarding point:", {
        winner: currentPlayer?.profiles?.username || submission.profile_id,
        currentScore,
        newScore
      });
      
      // Update score - don't use .single() on UPDATE queries with joins
      const { data: updatedPlayers, error: scoreUpdateError } = await supabase
        .from("room_players")
        .update({ score: newScore })
        .eq("room_id", roomId)
        .eq("profile_id", submission.profile_id)
        .select("score, profiles(username)");
      
      if (scoreUpdateError) {
        console.error("Error updating score:", scoreUpdateError);
        throw new Error("Failed to update winner's score: " + scoreUpdateError.message);
      }
      
      if (!updatedPlayers || updatedPlayers.length === 0) {
        console.error("Score update returned no data");
        throw new Error("Score update failed - no data returned");
      }
      
      // Get the first (and should be only) updated player
      const updatedPlayer = updatedPlayers[0];
      
      console.log("✓ Point awarded successfully:", {
        player: updatedPlayer.profiles?.username,
        oldScore: currentScore,
        newScore: updatedPlayer.score,
        verified: updatedPlayer.score === newScore
      });

      // STEP 2: Mark round as completed
      const { error: roundUpdateError } = await supabase.from("rounds").update({
        winner_profile_id: submission.profile_id,
        status: "completed"
      }).eq("id", currentRound.id);
      
      if (roundUpdateError) {
        console.error("Error updating round:", roundUpdateError);
        throw new Error("Failed to complete round: " + roundUpdateError.message);
      }
      
      setHasActiveRound(false);
      console.log("✓ Round marked as completed");

      // STEP 3: Store the completed round's judge ID IMMEDIATELY (before any state changes)
      // This ensures we always rotate from the correct judge
      const completedRoundJudgeId = currentRound?.judge_profile_id;
      
      if (!completedRoundJudgeId) {
        console.error("ERROR: currentRound has no judge_profile_id!", currentRound);
        throw new Error("Cannot determine judge for rotation - round has no judge");
      }
      
      console.log("=== STORING JUDGE FOR ROTATION ===");
      console.log("Completed round ID:", currentRound.id);
      console.log("Completed round judge ID:", completedRoundJudgeId);
      console.log("This judge will be used to calculate next judge");
      console.log("=== END STORING ===");

      // STEP 4: Refresh game data to show updated scores
      await loadGameData();

      // STEP 5: Start next round after delay (this will rotate judge and create new black card)
      setError(`Winner selected! +1 point awarded to ${currentPlayer?.profiles?.username || "winner"}. Next round starting...`);
      
      // Use a closure to ensure we capture the judge ID correctly
      const judgeIdForNextRound = completedRoundJudgeId;
      
      setTimeout(async () => {
        try {
          console.log("=== SETTIMEOUT CALLBACK EXECUTING ===");
          console.log("Judge ID to pass to nextRound:", judgeIdForNextRound);
          // Pass the completed round's judge to nextRound for reliable rotation
          await nextRound(judgeIdForNextRound);
        } catch (err) {
          console.error("Error in nextRound:", err);
          setError("Failed to start next round: " + err.message);
        }
      }, 3000);

    } catch (err) {
      console.error("Select winner error:", err);
      setError("Failed to select winner: " + err.message);
    }
  }

  async function nextRound(completedRoundJudgeId = null) {
    try {
      console.log("=== STARTING NEXT ROUND - ROTATING JUDGE ===");
      console.log("Received completed round judge ID:", completedRoundJudgeId);
      
      // STEP 1: Get the current judge
      // Priority 1: Use the judge passed as parameter (most reliable - from the round that just ended)
      // Priority 2: Query for most recent completed round
      // Priority 3: Fallback to any round
      let currentJudgeProfileId = completedRoundJudgeId;
      
      if (!currentJudgeProfileId) {
        console.log("No judge ID provided, querying database...");
        
        // Query for the most recent COMPLETED round (the one that just ended)
        const { data: completedRounds, error: roundError } = await supabase
          .from("rounds")
          .select("judge_profile_id, id, status")
          .eq("room_id", roomId)
          .eq("status", "completed")
          .order("id", { ascending: false })
          .limit(1);
        
        if (roundError) {
          console.warn("Could not fetch completed round:", roundError);
        } else if (completedRounds && completedRounds.length > 0) {
          currentJudgeProfileId = completedRounds[0].judge_profile_id;
          console.log("Current judge from most recent COMPLETED round:", {
            judge_profile_id: currentJudgeProfileId,
            round_id: completedRounds[0].id,
            status: completedRounds[0].status
          });
        } else {
          // If no completed rounds found, try to get from any round (fallback for first round)
          console.warn("No completed rounds found, trying most recent round...");
          const { data: recentRounds } = await supabase
            .from("rounds")
            .select("judge_profile_id, id, status")
            .eq("room_id", roomId)
            .order("id", { ascending: false })
            .limit(1);
          
          if (recentRounds && recentRounds.length > 0) {
            currentJudgeProfileId = recentRounds[0].judge_profile_id;
            console.log("Using most recent round (any status):", {
              judge_profile_id: currentJudgeProfileId,
              round_id: recentRounds[0].id,
              status: recentRounds[0].status
            });
          } else {
            console.warn("No rounds found in database at all");
          }
        }
      } else {
        console.log("Using provided judge ID from completed round:", currentJudgeProfileId);
      }
      
      // STEP 2: Get all players in the room, ordered by when they joined (consistent order)
      // This order acts as the "player_order" - players are numbered 0, 1, 2, etc. by join time
      const { data: allPlayers, error: playersError } = await supabase
        .from("room_players")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (playersError) {
        throw new Error("Failed to load players: " + playersError.message);
      }
      
      if (!allPlayers || allPlayers.length === 0) {
        throw new Error("No players found in room");
      }
      
      // Log players with their order/index (this is their "player_order")
      console.log("All players (ordered by join time - this is their player_order):", allPlayers.map((p, i) => ({
        player_order: i,  // This is the rotation order
        name: p.profiles?.username,
        id: p.profile_id,
        is_judge: p.is_judge,
        is_current_round_judge: p.profile_id === currentJudgeProfileId
      })));
      
      // STEP 3: Find current judge index using the round's judge_profile_id (most reliable)
      let currentJudgeIndex = -1;
      
      if (currentJudgeProfileId) {
        currentJudgeIndex = allPlayers.findIndex(p => p.profile_id === currentJudgeProfileId);
        if (currentJudgeIndex !== -1) {
          console.log("Found current judge by round judge_profile_id at player_order:", currentJudgeIndex);
        }
      }
      
      // Fallback: find by is_judge flag
      if (currentJudgeIndex === -1) {
        currentJudgeIndex = allPlayers.findIndex(p => p.is_judge);
        if (currentJudgeIndex !== -1) {
          console.warn("Found judge by is_judge flag at player_order:", currentJudgeIndex);
        }
      }
      
      if (currentJudgeIndex === -1) {
        // No judge found - set first player as judge
        console.log("No judge found, setting first player (player_order 0) as judge");
        await createActiveRound(allPlayers[0].profile_id);
        await loadGameData();
        return;
      }
      
      const currentJudge = allPlayers[currentJudgeIndex];
      console.log("Current judge:", {
        player_order: currentJudgeIndex,
        name: currentJudge.profiles?.username,
        id: currentJudge.profile_id
      });
      
      // STEP 4: Calculate next judge using player_order rotation
      // Simple rotation: (current_order + 1) % total_players
      const nextJudgeIndex = (currentJudgeIndex + 1) % allPlayers.length;
      const nextJudge = allPlayers[nextJudgeIndex];
      
      // Safety check: ensure we're rotating to a different player
      if (nextJudge.profile_id === currentJudge.profile_id) {
        console.error("ERROR: Next judge is same as current! This should never happen.");
        throw new Error("Judge rotation error - next judge is same as current");
      }
      
      console.log("=== JUDGE ROTATION CALCULATION ===");
      console.log("Next judge (by player_order rotation):", {
        current_player_order: currentJudgeIndex,
        current_judge_name: currentJudge.profiles?.username,
        current_judge_id: currentJudge.profile_id,
        next_player_order: nextJudgeIndex,
        next_judge_name: nextJudge.profiles?.username,
        next_judge_id: nextJudge.profile_id,
        total_players: allPlayers.length,
        rotation_formula: `(${currentJudgeIndex} + 1) % ${allPlayers.length} = ${nextJudgeIndex}`,
        rotation: `Player ${currentJudgeIndex} → Player ${nextJudgeIndex} (${((nextJudgeIndex - currentJudgeIndex + allPlayers.length) % allPlayers.length)} positions forward)`
      });
      console.log("=== END ROTATION CALCULATION ===");
      
      // STEP 4: Replenish cards to 10 per player
      console.log("Replenishing cards...");
      for (const player of allPlayers) {
        const { data: currentCards } = await supabase
          .from("player_hands")
          .select("white_card_id")
          .eq("room_id", roomId)
          .eq("profile_id", player.profile_id);
        
        const cardsNeeded = 10 - (currentCards?.length || 0);
        
        if (cardsNeeded > 0) {
          // Get all available white cards from the deck
          const { data: allDeckCards } = await supabase
            .from("white_cards")
            .select("id")
            .eq("deck_id", room.deck_id);
          
          if (allDeckCards && allDeckCards.length > 0) {
            // Get IDs of cards already in player's hand
            const cardsInHand = new Set((currentCards || []).map(c => c.white_card_id));
            
            // Filter out cards already in hand
            const availableCards = allDeckCards.filter(card => !cardsInHand.has(card.id));
            
            // Shuffle and take needed amount
            const shuffled = [...availableCards].sort(() => Math.random() - 0.5);
            const cardsToAdd = shuffled.slice(0, Math.min(cardsNeeded, shuffled.length));
            
            if (cardsToAdd.length > 0) {
              const newCards = cardsToAdd.map(card => ({
                room_id: roomId,
                profile_id: player.profile_id,
                white_card_id: card.id
              }));
              await supabase.from("player_hands").insert(newCards);
              console.log(`Added ${cardsToAdd.length} cards to ${player.profiles?.username}`);
            } else {
              console.warn(`No available cards for ${player.profiles?.username}`);
            }
          }
        }
      }
      console.log("✓ Cards replenished");

      // STEP 5: Clear old submissions from previous round (to prevent duplicates)
      // This ensures only submissions for the new round are shown
      console.log("Clearing submissions state for new round");
      setSubmissions([]);
      
      // STEP 6: Create new round with new judge (this creates new black card and sets judge)
      console.log("Creating new round with new judge:", nextJudge.profiles?.username);
      const newRound = await createActiveRound(nextJudge.profile_id);
      
      if (!newRound) {
        throw new Error("Failed to create new round");
      }
      
      console.log("✓ New round created - Judge:", nextJudge.profiles?.username);
      
      // STEP 7: Load full round details and update state
      const { data: fullRound, error: roundLoadError } = await supabase
        .from("rounds")
        .select(`
          *,
          black_cards(text),
          profiles!judge_profile_id(username)
        `)
        .eq("id", newRound.id)
        .single();
      
      if (roundLoadError) {
        console.error("Error loading full round:", roundLoadError);
      } else if (fullRound) {
        setCurrentRound(fullRound);
      }
      
      setHasActiveRound(true);

      // STEP 8: Refresh all game data (this will load submissions for the NEW round only)
      await loadGameData();
      
      // STEP 8: Verify the new judge was set correctly
      const { data: verifyPlayers } = await supabase
        .from("room_players")
        .select("profile_id, is_judge, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (verifyPlayers) {
        const actualJudge = verifyPlayers.find(p => p.is_judge);
        console.log("=== JUDGE VERIFICATION ===");
        console.log({
          expected_judge: nextJudge.profiles?.username,
          expected_id: nextJudge.profile_id,
          actual_judge: actualJudge?.profiles?.username,
          actual_id: actualJudge?.profile_id,
          match: actualJudge?.profile_id === nextJudge.profile_id
        });
        console.log("=== END VERIFICATION ===");
      }
      
      console.log("=== NEXT ROUND COMPLETE ===");
      setError(`New round! ${nextJudge.profiles?.username} is now the judge.`);
      setTimeout(() => setError(""), 3000);
      
    } catch (err) {
      console.error("Next round error:", err);
      setError("Failed to start next round: " + err.message);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      await supabase
        .from("messages")
        .insert({
          room_id: roomId,
          profile_id: user.id,
          content: newMessage.trim()
        });

      setNewMessage("");
    } catch (err) {
      console.error("Message error:", err);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-xl">Loading game...</div>
      </div>
    );
  }

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

  const isHost = room.party_leader === user.id;
  const isJudge = players.find(p => p.profile_id === user.id)?.is_judge;
  const hasSubmitted = submissions.some(s => s.profile_id === user.id);

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
        {/* Players */}
        <div className="lg:col-span-1">
          <div className="bg-zinc-900 rounded-lg p-4">
            <h2 className="font-bold mb-3">Players ({players.length})</h2>
            {players.map((player) => (
              <div key={player.profile_id} className="flex justify-between items-center mb-2 p-2 bg-zinc-800 rounded">
                <div>
                  <span className="text-sm">{player.profiles?.username || "Unknown"}</span>
                  {player.is_judge && <span className="ml-2 text-xs bg-purple-600 px-1 rounded">JUDGE</span>}
                  {player.profile_id === room.party_leader && <span className="ml-2 text-xs bg-yellow-600 px-1 rounded">HOST</span>}
                </div>
                <span className="text-xs text-zinc-400">{player.score} pts</span>
              </div>
            ))}
          </div>
        </div>

        {/* Game Area */}
        <div className="lg:col-span-2">
          <div className="bg-zinc-900 rounded-lg p-6">
            {room.status === "waiting" ? (
              /* WAITING FOR GAME TO START */
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
              /* GAME IS PLAYING - ALWAYS SHOW BLACK CARD AREA */
              <div className="space-y-6">
                {/* BLACK CARD - SIMPLE AND DIRECT */}
                <div className="text-center">
                  <div className="bg-black rounded-lg p-8 mb-4 border-2 border-white">
                    <h3 className="text-2xl font-bold mb-4 text-white">Black Card</h3>
                    <p className="text-2xl text-white mb-4">
                      {currentRound?.black_cards?.text || "I drink to forget _____."}
                    </p>
                    <p className="text-lg text-purple-300">
                      Judge: {currentRound?.profiles?.username || players.find(p => p.is_judge)?.profiles?.username || "Judge"}
                    </p>
                  </div>
                  
                  {/* GAME STATUS - SIMPLE */}
                  <div className="bg-zinc-800 rounded-lg p-4">
                    <div className="text-center">
                      <p className="text-lg text-zinc-300">
                        Cards Submitted: {submissions.length} / {players.filter(p => !p.is_judge).length}
                      </p>
                      {submissions.length === players.filter(p => !p.is_judge).length && (
                        <p className="text-yellow-400 mt-2">Judge is choosing winner!</p>
                      )}
                      {/* DEBUG: Show active round status */}
                      <div className="mt-3 text-xs text-zinc-500">
                        DEBUG: hasActiveRound={hasActiveRound ? "true" : "false"} | 
                        currentRound={currentRound ? "exists" : "null"} | 
                        roomStatus={room?.status}
                      </div>
                    </div>
                  </div>
                </div>

                {/* YOUR CARDS */}
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
                        <p className="text-green-400 text-center mt-4 text-lg font-bold">✓ Card Submitted!</p>
                      )}
                      {isJudge && (
                        <p className="text-purple-400 text-center mt-4 text-lg">You are judging this round - wait for submissions</p>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-zinc-400 text-lg">No cards in hand</p>
                      <button 
                        onClick={loadGameData}
                        className="mt-3 px-4 py-2 bg-blue-600 rounded hover:bg-blue-500"
                      >
                        Refresh Cards
                      </button>
                    </div>
                  )}
                </div>

                {/* Submissions Area - Judge View */}
                {isJudge && hasActiveRound && (
                  <div className="bg-purple-900/30 border-2 border-purple-600 rounded-lg p-6">
                    <div className="text-center mb-4">
                      <h3 className="text-2xl font-bold text-purple-200 mb-2">
                        ⚖️ Judge's Choice
                      </h3>
                      <p className="text-purple-300">
                        Submitted Cards: <span className="font-bold text-white">{submissions.length} / {players.filter(p => !p.is_judge).length}</span>
                      </p>
                      {currentRound && (
                        <p className="text-xs text-purple-400 mt-1">
                          Round ID: {currentRound.id}
                        </p>
                      )}
                      {/* Debug info */}
                      <div className="mt-2 text-xs text-purple-500 bg-purple-950/50 p-2 rounded">
                        <div>Debug: isJudge={String(isJudge)}, hasActiveRound={String(hasActiveRound)}</div>
                        <div>Submissions count: {submissions.length}</div>
                        <div>Round ID: {currentRound?.id || "none"}</div>
                        <div>Players (non-judge): {players.filter(p => !p.is_judge).length}</div>
                        {submissions.length === 0 && currentRound && (
                          <div className="mt-1 text-yellow-400">
                            ⚠️ No submissions found. Check console for RLS errors.
                          </div>
                        )}
                        {submissions.length > 0 && (
                          <div className="mt-1">
                            Submission IDs: {submissions.map(s => s.id).join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                    {submissions.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-purple-300 text-lg">Waiting for players to submit cards...</p>
                        <p className="text-purple-400 text-sm mt-2">Cards will appear here as players submit them</p>
                      </div>
                    ) : (
                      <div>
                        {submissions.length < players.filter(p => !p.is_judge).length && (
                          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3 mb-4 text-center">
                            <p className="text-yellow-300 font-semibold">
                              ⏳ {players.filter(p => !p.is_judge).length - submissions.length} more card(s) coming...
                            </p>
                            <p className="text-yellow-400 text-sm mt-1">You can preview cards as they arrive</p>
                          </div>
                        )}
                        {submissions.length === players.filter(p => !p.is_judge).length && (
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
                                <div className="text-xs text-zinc-500">
                                  Click to select winner
                                </div>
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

      {error && (
        <div className="fixed bottom-4 right-4 bg-red-900 border border-red-700 rounded-lg px-4 py-2 text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
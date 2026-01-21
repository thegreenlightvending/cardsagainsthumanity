import { supabase } from "../lib/supabase";

export async function startGame(roomId, deckId) {
  try {
    console.log("Step 1: Updating room status to playing");
    // 1. Update room status to "playing"
    const { error: roomError } = await supabase
      .from("rooms")
      .update({ status: "playing" })
      .eq("id", roomId);

    if (roomError) {
      console.error("Room update error:", roomError);
      throw roomError;
    }

    console.log("Step 2: Getting players");
    // 2. Get all players in the room
    const { data: players, error: playersError } = await supabase
      .from("room_players")
      .select("profile_id")
      .eq("room_id", roomId)
      .order("joined_at");

    if (playersError) {
      console.error("Players fetch error:", playersError);
      throw playersError;
    }

    console.log("Found players:", players);

    if (!players || players.length === 0) {
      throw new Error("No players found in room");
    }

    console.log("Step 3: Setting judge");
    // 3. Select first judge (first player who joined)
    const { error: judgeError } = await supabase
      .from("room_players")
      .update({ is_judge: true })
      .eq("room_id", roomId)
      .eq("profile_id", players[0].profile_id);

    if (judgeError) {
      console.error("Judge update error:", judgeError);
      throw judgeError;
    }

    console.log("Step 4: Dealing cards");
    // 4. Deal cards to all players
    await dealCardsToPlayers(roomId, deckId, players);

    console.log("Step 5: Starting first round");
    console.log("Judge will be:", players[0].profile_id);
    // 5. Start the first round
    try {
      await startNewRound(roomId, deckId, players[0].profile_id);
      console.log("Round created successfully in startGame");
    } catch (roundError) {
      console.error("Round creation failed in startGame:", roundError);
      throw new Error("Failed to create first round: " + roundError.message);
    }

    console.log("Game started successfully");
    return { success: true };
  } catch (error) {
    console.error("Error starting game:", error);
    throw error;
  }
}

async function dealCardsToPlayers(roomId, deckId, players) {
  console.log("Getting white cards for deck:", deckId);
  // Get white cards from the deck
  const { data: whiteCards, error: cardsError } = await supabase
    .from("white_cards")
    .select("id")
    .eq("deck_id", deckId);

  if (cardsError) {
    console.error("Cards fetch error:", cardsError);
    throw cardsError;
  }

  console.log("Found white cards:", whiteCards?.length);

  if (!whiteCards || whiteCards.length === 0) {
    throw new Error("No white cards found for this deck");
  }

  // Shuffle cards
  const shuffledCards = [...whiteCards].sort(() => Math.random() - 0.5);

  // Deal 7 cards to each player
  const cardsPerPlayer = 7;
  const hands = [];

  console.log("Dealing cards to", players.length, "players");

  for (let i = 0; i < players.length; i++) {
    const playerCards = shuffledCards.slice(
      i * cardsPerPlayer,
      (i + 1) * cardsPerPlayer
    );

    console.log(`Player ${i} gets ${playerCards.length} cards`);

    for (const card of playerCards) {
      hands.push({
        room_id: roomId,
        profile_id: players[i].profile_id,
        white_card_id: card.id
      });
    }
  }

  console.log("Inserting", hands.length, "cards into player_hands");

  // Insert all hands at once
  const { error: handsError } = await supabase
    .from("player_hands")
    .insert(hands);

  if (handsError) {
    console.error("Hands insert error:", handsError);
    throw handsError;
  }

  console.log("Cards dealt successfully");
}

async function startNewRound(roomId, deckId, judgeId) {
  console.log("Starting new round with deckId:", deckId, "judgeId:", judgeId);
  
  // Get a random black card
  const { data: blackCards, error: blackCardsError } = await supabase
    .from("black_cards")
    .select("id")
    .eq("deck_id", deckId);

  if (blackCardsError) {
    console.error("Black cards fetch error:", blackCardsError);
    throw blackCardsError;
  }

  console.log("Found black cards:", blackCards?.length);

  if (!blackCards || blackCards.length === 0) {
    throw new Error("No black cards found for this deck");
  }

  const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];
  console.log("Selected black card:", randomBlackCard.id);

  // Create the round
  const { data: roundData, error: roundError } = await supabase
    .from("rounds")
    .insert({
      room_id: roomId,
      black_card_id: randomBlackCard.id,
      judge_profile_id: judgeId,
      status: "submitting"
    })
    .select()
    .single();

  if (roundError) {
    console.error("Round creation error:", roundError);
    throw roundError;
  }

  console.log("Round created successfully:", roundData);
}

export async function submitCard(roundId, profileId, whiteCardId) {
  try {
    // Check if player already submitted
    const { data: existing, error: checkError } = await supabase
      .from("submissions")
      .select("id")
      .eq("round_id", roundId)
      .eq("profile_id", profileId)
      .single();

    if (existing) {
      throw new Error("You have already submitted a card for this round");
    }

    // Submit the card
    const { error: submitError } = await supabase
      .from("submissions")
      .insert({
        round_id: roundId,
        profile_id: profileId,
        white_card_id: whiteCardId
      });

    if (submitError) throw submitError;

    // Remove card from player's hand
    const { error: handError } = await supabase
      .from("player_hands")
      .delete()
      .eq("profile_id", profileId)
      .eq("white_card_id", whiteCardId);

    if (handError) throw handError;

    return { success: true };
  } catch (error) {
    console.error("Error submitting card:", error);
    throw error;
  }
}

export async function selectWinner(roundId, winningSubmissionId, judgeId) {
  try {
    // Get the winning submission
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .select("profile_id")
      .eq("id", winningSubmissionId)
      .single();

    if (submissionError) throw submissionError;

    // Update the round with winner
    const { error: roundError } = await supabase
      .from("rounds")
      .update({
        winner_profile_id: submission.profile_id,
        status: "completed",
        end_time: new Date().toISOString()
      })
      .eq("id", roundId)
      .eq("judge_profile_id", judgeId); // Ensure only judge can select winner

    if (roundError) throw roundError;

    // Update winner's score
    const { error: scoreError } = await supabase
      .rpc("increment_player_score", {
        room_uuid: submission.room_id,
        player_uuid: submission.profile_id
      });

    if (scoreError) throw scoreError;

    return { success: true };
  } catch (error) {
    console.error("Error selecting winner:", error);
    throw error;
  }
}
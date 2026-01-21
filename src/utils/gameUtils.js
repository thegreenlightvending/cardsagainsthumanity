import { supabase } from "../lib/supabase";

export async function startGame(roomId, deckId) {
  try {
    // 1. Update room status to "playing"
    const { error: roomError } = await supabase
      .from("rooms")
      .update({ status: "playing" })
      .eq("id", roomId);

    if (roomError) throw roomError;

    // 2. Get all players in the room
    const { data: players, error: playersError } = await supabase
      .from("room_players")
      .select("profile_id")
      .eq("room_id", roomId)
      .order("joined_at");

    if (playersError) throw playersError;

    // 3. Select first judge (first player who joined)
    if (players.length > 0) {
      const { error: judgeError } = await supabase
        .from("room_players")
        .update({ is_judge: true })
        .eq("room_id", roomId)
        .eq("profile_id", players[0].profile_id);

      if (judgeError) throw judgeError;
    }

    // 4. Deal cards to all players
    await dealCardsToPlayers(roomId, deckId, players);

    // 5. Start the first round
    await startNewRound(roomId, deckId, players[0].profile_id);

    return { success: true };
  } catch (error) {
    console.error("Error starting game:", error);
    throw error;
  }
}

async function dealCardsToPlayers(roomId, deckId, players) {
  // Get white cards from the deck
  const { data: whiteCards, error: cardsError } = await supabase
    .from("white_cards")
    .select("id")
    .eq("deck_id", deckId);

  if (cardsError) throw cardsError;

  // Shuffle cards
  const shuffledCards = [...whiteCards].sort(() => Math.random() - 0.5);

  // Deal 7 cards to each player
  const cardsPerPlayer = 7;
  const hands = [];

  for (let i = 0; i < players.length; i++) {
    const playerCards = shuffledCards.slice(
      i * cardsPerPlayer,
      (i + 1) * cardsPerPlayer
    );

    for (const card of playerCards) {
      hands.push({
        room_id: roomId,
        profile_id: players[i].profile_id,
        white_card_id: card.id
      });
    }
  }

  // Insert all hands at once
  const { error: handsError } = await supabase
    .from("player_hands")
    .insert(hands);

  if (handsError) throw handsError;
}

async function startNewRound(roomId, deckId, judgeId) {
  // Get a random black card
  const { data: blackCards, error: blackCardsError } = await supabase
    .from("black_cards")
    .select("id")
    .eq("deck_id", deckId);

  if (blackCardsError) throw blackCardsError;

  const randomBlackCard = blackCards[Math.floor(Math.random() * blackCards.length)];

  // Create the round
  const { error: roundError } = await supabase
    .from("rounds")
    .insert({
      room_id: roomId,
      black_card_id: randomBlackCard.id,
      judge_profile_id: judgeId,
      status: "submitting"
    });

  if (roundError) throw roundError;
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
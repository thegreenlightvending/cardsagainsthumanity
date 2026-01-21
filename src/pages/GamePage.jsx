import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";

export default function GamePage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Game state
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [currentRound, setCurrentRound] = useState(null);
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
        // Load current round
        const { data: roundData } = await supabase
          .from("rounds")
          .select("*, black_cards(text), profiles!judge_profile_id(username)")
          .eq("room_id", roomId)
          .in("status", ["submitting", "judging"])
          .order("created_at", { ascending: false })
          .limit(1);
        
        if (roundData && roundData.length > 0) {
          setCurrentRound(roundData[0]);
        }

        // Load player hand
        const { data: handData } = await supabase
          .from("player_hands")
          .select("*, white_cards(text)")
          .eq("room_id", roomId)
          .eq("profile_id", user.id);
        
        if (handData) setPlayerHand(handData);

        // Load submissions
        if (roundData && roundData.length > 0) {
          const { data: submissionsData } = await supabase
            .from("submissions")
            .select("*, white_cards(text), profiles(username)")
            .eq("round_id", roundData[0].id);
          
          if (submissionsData) setSubmissions(submissionsData);
        }
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

  async function startGame() {
    try {
      setError("Starting game...");
      
      // First, reload player data to ensure we have current players
      const { data: currentPlayers, error: playersError } = await supabase
        .from("room_players")
        .select("*, profiles(username)")
        .eq("room_id", roomId)
        .order("joined_at");
      
      if (playersError) {
        throw new Error("Failed to load players: " + playersError.message);
      }
      
      if (!currentPlayers || currentPlayers.length === 0) {
        throw new Error("No players found in room");
      }
      
      if (currentPlayers.length < 3) {
        throw new Error("Need at least 3 players to start");
      }
      
      // Update players state
      setPlayers(currentPlayers);
      
      // Update room status
      await supabase.from("rooms").update({ status: "playing" }).eq("id", roomId);
      
      // Set first player as judge
      await supabase
        .from("room_players")
        .update({ is_judge: true })
        .eq("room_id", roomId)
        .eq("profile_id", currentPlayers[0].profile_id);
      
      // Deal cards to all players
      await dealCards(currentPlayers);
      
      // Create first round
      await createRound(currentPlayers);
      
      // Refresh game data to show the new round
      await loadGameData();
      
      setError("Game started!");
      setTimeout(() => setError(""), 2000);
    } catch (err) {
      console.error("Start game error:", err);
      setError("Failed to start game: " + err.message);
    }
  }

  async function dealCards(playersToUse = players) {
    // Clear existing hands first
    await supabase
      .from("player_hands")
      .delete()
      .eq("room_id", roomId);

    // Get white cards
    const { data: whiteCards } = await supabase
      .from("white_cards")
      .select("id")
      .eq("deck_id", room.deck_id);

    if (!whiteCards || whiteCards.length === 0) {
      throw new Error("No white cards found");
    }

    if (whiteCards.length < playersToUse.length * 10) {
      throw new Error("Not enough cards for all players");
    }

    // Shuffle cards
    const shuffled = [...whiteCards].sort(() => Math.random() - 0.5);

    // Deal 10 cards to EVERY player (including judge)
    const hands = [];
    let cardIndex = 0;
    
    for (let i = 0; i < playersToUse.length; i++) {
      for (let j = 0; j < 10; j++) {
        hands.push({
          room_id: roomId,
          profile_id: playersToUse[i].profile_id,
          white_card_id: shuffled[cardIndex].id
        });
        cardIndex++;
      }
    }

    // Insert all hands
    const { error } = await supabase.from("player_hands").insert(hands);
    if (error) throw error;
  }

  async function createRound(playersToUse = players) {
    // Get random black card
    const { data: blackCards } = await supabase
      .from("black_cards")
      .select("id")
      .eq("deck_id", room.deck_id);

    if (!blackCards || blackCards.length === 0) {
      throw new Error("No black cards found");
    }

    const randomCard = blackCards[Math.floor(Math.random() * blackCards.length)];
    const judge = playersToUse.find(p => p.is_judge);

    if (!judge) {
      throw new Error("No judge found");
    }

    // Create round
    const { error } = await supabase
      .from("rounds")
      .insert({
        room_id: roomId,
        black_card_id: randomCard.id,
        judge_profile_id: judge.profile_id,
        status: "submitting"
      });

    if (error) throw error;
  }

  async function submitCard(cardId) {
    try {
      if (!currentRound) {
        setError("No active round");
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

      if (submitError) throw submitError;

      // Remove card from hand
      const { error: removeError } = await supabase
        .from("player_hands")
        .delete()
        .eq("profile_id", user.id)
        .eq("white_card_id", cardId);

      if (removeError) throw removeError;

      setError("Card submitted!");
      setTimeout(() => setError(""), 2000);
    } catch (err) {
      console.error("Submit error:", err);
      setError("Failed to submit card: " + err.message);
    }
  }

  async function selectWinner(submissionId) {
    try {
      // Get submission details
      const { data: submission } = await supabase
        .from("submissions")
        .select("profile_id")
        .eq("id", submissionId)
        .single();

      if (!submission) throw new Error("Submission not found");

      // Update round as completed
      await supabase
        .from("rounds")
        .update({
          winner_profile_id: submission.profile_id,
          status: "completed",
          end_time: new Date().toISOString()
        })
        .eq("id", currentRound.id);

      // Update winner's score
      const { data: currentPlayer } = await supabase
        .from("room_players")
        .select("score")
        .eq("room_id", roomId)
        .eq("profile_id", submission.profile_id)
        .single();

      await supabase
        .from("room_players")
        .update({ score: (currentPlayer?.score || 0) + 1 })
        .eq("room_id", roomId)
        .eq("profile_id", submission.profile_id);

      // Start next round after delay
      setTimeout(async () => {
        await nextRound();
      }, 3000);

      setError("Winner selected! Next round starting...");
    } catch (err) {
      console.error("Select winner error:", err);
      setError("Failed to select winner: " + err.message);
    }
  }

  async function nextRound() {
    try {
      // Rotate judge
      const currentJudgeIndex = players.findIndex(p => p.is_judge);
      const nextJudgeIndex = currentJudgeIndex >= 0 ? (currentJudgeIndex + 1) % players.length : 0;

      // Clear all judges first
      await supabase
        .from("room_players")
        .update({ is_judge: false })
        .eq("room_id", roomId);

      // Set new judge
      if (players[nextJudgeIndex]) {
        await supabase
          .from("room_players")
          .update({ is_judge: true })
          .eq("room_id", roomId)
          .eq("profile_id", players[nextJudgeIndex].profile_id);
      }

      // Replenish cards to 10 per player
      for (const player of players) {
        // Count current cards
        const { data: currentCards } = await supabase
          .from("player_hands")
          .select("id")
          .eq("room_id", roomId)
          .eq("profile_id", player.profile_id);

        const cardsNeeded = 10 - (currentCards?.length || 0);
        
        if (cardsNeeded > 0) {
          // Get cards not in any player's hand
          const { data: usedCards } = await supabase
            .from("player_hands")
            .select("white_card_id")
            .eq("room_id", roomId);

          const usedCardIds = usedCards?.map(c => c.white_card_id) || [];

          const { data: availableCards } = await supabase
            .from("white_cards")
            .select("id")
            .eq("deck_id", room.deck_id)
            .not("id", "in", `(${usedCardIds.join(",") || "0"})`)
            .limit(cardsNeeded);

          if (availableCards && availableCards.length > 0) {
            const newCards = availableCards.slice(0, cardsNeeded).map(card => ({
              room_id: roomId,
              profile_id: player.profile_id,
              white_card_id: card.id
            }));

            await supabase.from("player_hands").insert(newCards);
          }
        }
      }

      // Create new round
      await createRound();
    } catch (err) {
      console.error("Next round error:", err);
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
                {currentRound && (
                  <div className="text-center">
                    <div className="bg-black rounded-lg p-6 mb-4">
                      <h3 className="text-lg font-bold mb-3 text-white">Black Card</h3>
                      <p className="text-xl text-white">{currentRound.black_cards?.text}</p>
                      <p className="text-sm text-zinc-400 mt-2">
                        Judge: {currentRound.profiles?.username}
                      </p>
                    </div>
                    <p className="text-zinc-400">
                      {submissions.length} / {players.filter(p => !p.is_judge).length} cards submitted
                      {submissions.length === players.filter(p => !p.is_judge).length && (
                        <span className="text-yellow-400 ml-2">• Judge is choosing winner...</span>
                      )}
                    </p>
                  </div>
                )}

                {/* Player Hand */}
                {playerHand.length > 0 && (
                  <div>
                    <h3 className="font-bold mb-3">
                      Your Cards ({playerHand.length})
                      {isJudge && <span className="text-purple-400 ml-2">(You are the Judge)</span>}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {playerHand.map((card) => (
                        <button
                          key={card.id}
                          onClick={() => !isJudge && submitCard(card.white_card_id)}
                          disabled={isJudge || hasSubmitted}
                          className={`p-3 rounded text-sm ${
                            isJudge 
                              ? "bg-gray-600 text-gray-300 cursor-not-allowed" 
                              : "bg-white text-black hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          }`}
                        >
                          {card.white_cards?.text}
                        </button>
                      ))}
                    </div>
                    {hasSubmitted && !isJudge && (
                      <p className="text-green-400 text-center mt-3">✓ Card submitted!</p>
                    )}
                    {isJudge && (
                      <p className="text-purple-400 text-center mt-3">You are judging this round</p>
                    )}
                  </div>
                )}

                {/* Submissions Area */}
                {isJudge && (
                  <div>
                    <h3 className="font-bold mb-3">
                      Submitted Cards ({submissions.length} / {players.filter(p => !p.is_judge).length})
                    </h3>
                    {submissions.length === 0 && (
                      <p className="text-zinc-400 text-center py-6">Waiting for players to submit cards...</p>
                    )}
                    {submissions.length > 0 && submissions.length < players.filter(p => !p.is_judge).length && (
                      <div className="space-y-2">
                        <p className="text-zinc-400 text-center">Cards submitted so far:</p>
                        {submissions.map((submission, index) => (
                          <div key={submission.id} className="bg-white text-black p-3 rounded opacity-75">
                            Card #{index + 1}: {submission.white_cards?.text}
                          </div>
                        ))}
                        <p className="text-yellow-400 text-center">Waiting for more submissions...</p>
                      </div>
                    )}
                    {submissions.length === players.filter(p => !p.is_judge).length && (
                      <div>
                        <p className="text-green-400 text-center mb-4">All cards submitted! Choose the winner:</p>
                        <div className="grid grid-cols-1 gap-3">
                          {submissions.map((submission, index) => (
                            <button
                              key={submission.id}
                              onClick={() => selectWinner(submission.id)}
                              className="bg-white text-black p-4 rounded text-left hover:bg-yellow-100 border-2 border-transparent hover:border-yellow-400"
                            >
                              <div className="font-bold mb-1">Card #{index + 1}</div>
                              <div>{submission.white_cards?.text}</div>
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
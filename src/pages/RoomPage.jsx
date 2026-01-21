import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { ensureUserProfile } from "../utils/profileUtils";
import { startGame, submitCard, selectWinner } from "../utils/gameUtils";

async function startNewRound(roomId, deckId, judgeId) {
  // Get a random black card
  const { data: blackCards, error: blackCardsError } = await supabase
    .from("black_cards")
    .select("id")
    .eq("deck_id", deckId);

  if (blackCardsError) throw blackCardsError;

  if (!blackCards || blackCards.length === 0) {
    throw new Error("No black cards found for this deck");
  }

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

export default function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentRound, setCurrentRound] = useState(null);
  const [playerHand, setPlayerHand] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!roomId) return;
    
    loadRoomData();
    
    // Poll for updates every 2 seconds (more reliable than real-time for now)
    const pollInterval = setInterval(() => {
      loadMessages();
      loadPlayers();
      if (room?.status === "playing") {
        loadCurrentRound();
        loadPlayerHand();
        loadSubmissions();
      }
    }, 2000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [roomId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadRoomData() {
    try {
      await Promise.all([
        loadRoom(),
        loadPlayers(),
        loadMessages()
      ]);
    } catch (err) {
      setError(err.message || "Failed to load room");
    } finally {
      setLoading(false);
    }
  }

  async function loadRoom() {
    const { data, error } = await supabase
      .from("rooms")
      .select(`
        *,
        decks(name, type),
        profiles!party_leader(username)
      `)
      .eq("id", roomId)
      .single();

    if (error) throw error;
    setRoom(data);
  }

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("room_players")
      .select(`
        *,
        profiles(username)
      `)
      .eq("room_id", roomId)
      .order("joined_at");

    if (error) throw error;
    setPlayers(data || []);
  }

  async function loadMessages() {
    try {
      const { data, error } = await supabase
        .from("messages")
        .select(`
          *,
          profiles(username)
        `)
        .eq("room_id", roomId)
        .order("created_at")
        .limit(50);

      if (error) throw error;
      
      // Only update if messages have actually changed
      setMessages(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(data || [])) {
          return data || [];
        }
        return prev;
      });
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    try {
      // Ensure user has a profile first
      await ensureUserProfile(user);

      const { error } = await supabase
        .from("messages")
        .insert({
          room_id: roomId,
          profile_id: user.id,
          content: newMessage.trim()
        });

      if (error) throw error;
      setNewMessage("");
      
      // Immediately reload messages to show the new one
      loadMessages();
    } catch (err) {
      setError("Failed to send message: " + err.message);
    }
  }

  async function handleStartGame() {
    try {
      setError("Starting game...");
      console.log("Starting game with roomId:", roomId, "deckId:", room.deck_id);
      
      const result = await startGame(roomId, room.deck_id);
      console.log("Game start result:", result);
      
      setError("Game started! Loading round...");
      
      // Reload all game data with longer delay
      setTimeout(async () => {
        console.log("Reloading game data after start...");
        await loadRoomData();
        await loadCurrentRound();
        await loadPlayerHand();
        await loadPlayers();
        console.log("Game data reloaded");
      }, 2000);
    } catch (err) {
      console.error("Game start error:", err);
      setError("Failed to start game: " + err.message);
    }
  }

  async function loadCurrentRound() {
    try {
      console.log("Loading current round for room:", roomId);
      const { data, error } = await supabase
        .from("rounds")
        .select(`
          *,
          black_cards(text, pick),
          profiles!judge_profile_id(username)
        `)
        .eq("room_id", roomId)
        .eq("status", "submitting")
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("Round query error:", error);
        throw error;
      }

      console.log("Round query result:", data);
      
      if (data && data.length > 0) {
        setCurrentRound(data[0]);
        console.log("Set current round:", data[0]);
      } else {
        setCurrentRound(null);
        console.log("No active round found");
      }
    } catch (err) {
      console.error("Failed to load current round:", err);
    }
  }

  async function loadPlayerHand() {
    try {
      console.log("Loading player hand for:", user.id, "in room:", roomId);
      const { data, error } = await supabase
        .from("player_hands")
        .select(`
          *,
          white_cards(text)
        `)
        .eq("room_id", roomId)
        .eq("profile_id", user.id);

      if (error) {
        console.error("Player hand query error:", error);
        throw error;
      }
      
      console.log("Player hand data:", data);
      setPlayerHand(data || []);
    } catch (err) {
      console.error("Failed to load player hand:", err);
    }
  }

  async function loadSubmissions() {
    if (!currentRound) return;
    
    try {
      const { data, error } = await supabase
        .from("submissions")
        .select(`
          *,
          white_cards(text),
          profiles(username)
        `)
        .eq("round_id", currentRound.id);

      if (error) throw error;
      setSubmissions(data || []);
    } catch (err) {
      console.error("Failed to load submissions:", err);
    }
  }

  async function handleSubmitCard(whiteCardId) {
    try {
      if (!currentRound) {
        setError("No active round found. Please wait for the round to start.");
        return;
      }
      
      console.log("Submitting card:", whiteCardId, "for round:", currentRound.id);
      await submitCard(currentRound.id, user.id, whiteCardId);
      setError("Card submitted!");
      loadPlayerHand();
      loadSubmissions();
    } catch (err) {
      console.error("Card submission error:", err);
      setError("Failed to submit card: " + err.message);
    }
  }

  async function handleSelectWinner(submissionId) {
    try {
      if (!currentRound) {
        setError("No active round found.");
        return;
      }

      console.log("Selecting winner:", submissionId);
      await selectWinner(currentRound.id, submissionId, user.id);
      setError("Winner selected! Starting next round...");
      
      // Start next round after a short delay
      setTimeout(async () => {
        await startNextRound();
        loadRoomData();
        loadCurrentRound();
        loadPlayerHand();
      }, 3000);
    } catch (err) {
      console.error("Winner selection error:", err);
      setError("Failed to select winner: " + err.message);
    }
  }

  async function startNextRound() {
    try {
      // Get current players and rotate judge
      const nonJudgePlayers = players.filter(p => !p.is_judge);
      const currentJudge = players.find(p => p.is_judge);
      
      if (nonJudgePlayers.length === 0) return;
      
      // Find next judge (rotate)
      const currentJudgeIndex = players.findIndex(p => p.profile_id === currentJudge.profile_id);
      const nextJudgeIndex = (currentJudgeIndex + 1) % players.length;
      const nextJudge = players[nextJudgeIndex];

      // Update judge
      await supabase
        .from("room_players")
        .update({ is_judge: false })
        .eq("room_id", roomId);

      await supabase
        .from("room_players")
        .update({ is_judge: true })
        .eq("room_id", roomId)
        .eq("profile_id", nextJudge.profile_id);

      // Deal new cards to players who need them (should have 7)
      await dealNewCards();

      // Start new round
      await startNewRound(roomId, room.deck_id, nextJudge.profile_id);
    } catch (err) {
      console.error("Failed to start next round:", err);
    }
  }

  async function dealNewCards() {
    try {
      // Check each player's hand and deal cards to get back to 7
      for (const player of players) {
        const { data: hand } = await supabase
          .from("player_hands")
          .select("id")
          .eq("room_id", roomId)
          .eq("profile_id", player.profile_id);

        const cardsNeeded = 7 - (hand?.length || 0);
        
        if (cardsNeeded > 0) {
          // Get random white cards
          const { data: availableCards } = await supabase
            .from("white_cards")
            .select("id")
            .eq("deck_id", room.deck_id)
            .limit(cardsNeeded * 2); // Get extra to avoid duplicates

          if (availableCards && availableCards.length > 0) {
            const shuffled = availableCards.sort(() => Math.random() - 0.5);
            const cardsToAdd = shuffled.slice(0, cardsNeeded);

            const newCards = cardsToAdd.map(card => ({
              room_id: roomId,
              profile_id: player.profile_id,
              white_card_id: card.id
            }));

            await supabase
              .from("player_hands")
              .insert(newCards);
          }
        }
      }
    } catch (err) {
      console.error("Failed to deal new cards:", err);
    }
  }

  async function leaveRoom() {
    try {
      const { error } = await supabase
        .from("room_players")
        .delete()
        .eq("room_id", roomId)
        .eq("profile_id", user.id);

      if (error) throw error;
      navigate("/");
    } catch (err) {
      setError("Failed to leave room: " + err.message);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-xl">Loading room...</div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Room not found</h1>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const isHost = room.party_leader === user.id;
  const currentPlayer = players.find(p => p.profile_id === user.id);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      {/* Header */}
      <div className="bg-zinc-900/50 border-b border-zinc-800 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              {room.profiles?.username || "Unknown"}'s Room
            </h1>
            <div className="text-sm text-zinc-400 flex items-center gap-4">
              <span>{room.decks?.name} ({room.decks?.type})</span>
              <span>{players.length} / {room.max_players} players</span>
              <span>Status: {room.status}</span>
              {room.turn_timer_seconds && (
                <span>⏱️ {room.turn_timer_seconds}s timer</span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {isHost && room.status === "waiting" && players.length >= 3 && (
              <button
                onClick={handleStartGame}
                className="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors"
              >
                Start Game
              </button>
            )}
            <button
              onClick={leaveRoom}
              className="px-4 py-2 bg-red-600 rounded-lg hover:bg-red-500 transition-colors"
            >
              Leave Room
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Players List */}
        <div className="lg:col-span-1">
          <div className="bg-zinc-900/50 rounded-xl p-4">
            <h2 className="font-bold mb-4">Players ({players.length})</h2>
            <div className="space-y-2">
              {players.map((player) => (
                <div
                  key={player.profile_id}
                  className="flex items-center justify-between p-2 bg-zinc-800/50 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {player.profiles?.username || "Unknown"}
                    </span>
                    {player.profile_id === room.party_leader && (
                      <span className="text-xs bg-yellow-600 px-1 rounded">HOST</span>
                    )}
                    {player.is_judge && (
                      <span className="text-xs bg-purple-600 px-1 rounded">JUDGE</span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-400">
                    Score: {player.score}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Game Area */}
        <div className="lg:col-span-2">
          <div className="bg-zinc-900/50 rounded-xl p-6 min-h-96">
            {room.status === "waiting" ? (
              <div className="text-center py-12">
                <h2 className="text-2xl font-bold mb-4">Waiting for players...</h2>
                <p className="text-zinc-400 mb-6">
                  Need at least 3 players to start the game.
                </p>
                {room.is_private && room.password && (
                  <div className="bg-zinc-800/50 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm text-zinc-300 mb-2">Room Code:</p>
                    <code className="text-lg font-mono bg-zinc-900 px-3 py-1 rounded">
                      {room.password}
                    </code>
                    <p className="text-xs text-zinc-500 mt-2">
                      Share this code with friends to join
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Show round info even if currentRound is incomplete */}
                {room.status === "playing" && (
                  <div className="bg-yellow-900/20 border border-yellow-500 rounded p-3 mb-4 text-xs">
                    <strong>Round Debug:</strong><br/>
                    Current Round Object: {currentRound ? 'Exists' : 'Null'}<br/>
                    {currentRound && (
                      <>
                        Round ID: {currentRound.id}<br/>
                        Black Card ID: {currentRound.black_card_id}<br/>
                        Black Card Text: {currentRound.black_cards?.text || 'Missing'}<br/>
                        Judge: {currentRound.profiles?.username || currentRound.judge_profile_id}<br/>
                        Status: {currentRound.status}
                      </>
                    )}
                  </div>
                )}

                {/* BLACK CARD DISPLAY - Always show when game is playing */}
                {room.status === "playing" && (
                  <div className="text-center mb-6">
                    <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-xl p-6 mb-4 border-2 border-zinc-700 shadow-xl">
                      <div className="flex items-center justify-center gap-2 mb-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <h3 className="text-lg font-bold text-zinc-200">Black Card</h3>
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      </div>
                      <div className="bg-black rounded-lg p-4 mb-3 min-h-[80px] flex items-center justify-center">
                        <p className="text-white text-xl font-medium leading-relaxed">
                          {currentRound?.black_cards?.text || "No round active - click 'Force Start Round' to begin"}
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        Judge: {currentRound?.profiles?.username || players.find(p => p.is_judge)?.profiles?.username || "No judge assigned"}
                      </div>
                    </div>

                    {/* Submissions Status */}
                    <div className="flex items-center justify-center gap-4 text-sm mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                        <span className="text-emerald-400">{submissions.length} submitted</span>
                      </div>
                      <div className="w-1 h-4 bg-zinc-600"></div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-zinc-500 rounded-full"></div>
                        <span className="text-zinc-400">{players.filter(p => !p.is_judge).length - submissions.length} waiting</span>
                      </div>
                    </div>

                    {/* Show submitted cards (face down) for everyone to see */}
                    {submissions.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-sm font-medium text-zinc-400 mb-3">Submitted Cards</h4>
                        <div className="flex justify-center gap-2 flex-wrap">
                          {submissions.map((_, index) => (
                            <div
                              key={index}
                              className="w-16 h-20 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg border-2 border-blue-400 shadow-lg flex items-center justify-center"
                            >
                              <div className="text-white text-xs font-bold">#{index + 1}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Remove the old conditional black card display since we have it above now */}
                {false && room.status === "playing" && currentRound && (
                  <div className="text-center mb-6">
                    <div className="bg-gradient-to-br from-zinc-800 to-zinc-900 rounded-xl p-6 mb-4 border-2 border-zinc-700 shadow-xl">
                      <div className="flex items-center justify-center gap-2 mb-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                        <h3 className="text-lg font-bold text-zinc-200">Black Card</h3>
                        <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                      </div>
                      <div className="bg-black rounded-lg p-4 mb-3 min-h-[80px] flex items-center justify-center">
                        <p className="text-white text-xl font-medium leading-relaxed">
                          {currentRound.black_cards?.text || "Loading black card..."}
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        Judge: {currentRound.profiles?.username}
                      </div>
                    </div>

                    {/* Submissions Status */}
                    <div className="flex items-center justify-center gap-4 text-sm mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                        <span className="text-emerald-400">{submissions.length} submitted</span>
                      </div>
                      <div className="w-1 h-4 bg-zinc-600"></div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-zinc-500 rounded-full"></div>
                        <span className="text-zinc-400">{players.filter(p => !p.is_judge).length - submissions.length} waiting</span>
                      </div>
                    </div>

                    {/* Show submitted cards (face down) for everyone to see */}
                    {submissions.length > 0 && (
                      <div className="mb-6">
                        <h4 className="text-sm font-medium text-zinc-400 mb-3">Submitted Cards</h4>
                        <div className="flex justify-center gap-2 flex-wrap">
                          {submissions.map((_, index) => (
                            <div
                              key={index}
                              className="w-16 h-20 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg border-2 border-blue-400 shadow-lg flex items-center justify-center"
                            >
                              <div className="text-white text-xs font-bold">#{index + 1}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Debug Info */}
                {room.status === "playing" && (
                  <div className="bg-red-900/20 border border-red-500 rounded p-3 mb-4 text-xs">
                    <strong>Debug Info:</strong><br/>
                    Room Status: {room.status}<br/>
                    Deck ID: {room.deck_id}<br/>
                    Current Round: {currentRound ? 'Yes' : 'No'}<br/>
                    Player Hand: {playerHand.length} cards<br/>
                    Submissions: {submissions.length}<br/>
                    Is Judge: {players.find(p => p.profile_id === user.id)?.is_judge ? 'Yes' : 'No'}<br/>
                    <div className="mt-2 space-x-2">
                      <button 
                        onClick={async () => {
                          const { data } = await supabase.from("black_cards").select("*").eq("deck_id", room.deck_id);
                          console.log("Black cards for deck:", data);
                          alert(`Found ${data?.length || 0} black cards`);
                        }}
                        className="px-2 py-1 bg-blue-600 text-white rounded text-xs"
                      >
                        Check Black Cards
                      </button>
                      <button 
                        onClick={async () => {
                          const { data } = await supabase.from("rounds").select("*, black_cards(*)").eq("room_id", roomId);
                          console.log("All rounds for room:", data);
                          alert(`Found ${data?.length || 0} rounds. Check console for details.`);
                        }}
                        className="px-2 py-1 bg-purple-600 text-white rounded text-xs"
                      >
                        Check Rounds
                      </button>
                      <button 
                        onClick={async () => {
                          // Just show a random black card for testing
                          const { data } = await supabase.from("black_cards").select("*").eq("deck_id", room.deck_id).limit(1);
                          if (data && data[0]) {
                            setCurrentRound({
                              id: 'test',
                              black_cards: { text: data[0].text },
                              profiles: { username: 'Test Judge' },
                              status: 'submitting'
                            });
                            setError("Test black card loaded!");
                          }
                        }}
                        className="px-2 py-1 bg-orange-600 text-white rounded text-xs"
                      >
                        Test Black Card
                      </button>
                    </div>
                  </div>
                )}

                {/* Player Hand (show if game is playing and not judge) */}
                {room.status === "playing" && !players.find(p => p.profile_id === user.id)?.is_judge && (
                  <div>
                    <h3 className="font-bold mb-3 text-center">Your Hand ({playerHand.length} cards)</h3>
                    {playerHand.length === 0 ? (
                      <div className="text-center text-zinc-400 py-8">
                        <p>No cards in hand</p>
                        <p className="text-xs mt-2">If cards don't appear, check browser console for errors</p>
                        <div className="space-y-2">
                          <button 
                            onClick={() => {
                              console.log("Manual reload triggered");
                              loadPlayerHand();
                              loadCurrentRound();
                            }}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 mr-2"
                          >
                            Reload Cards
                          </button>
                          <button 
                            onClick={async () => {
                              try {
                                console.log("Manual round start triggered");
                                console.log("Players:", players);
                                console.log("Room deck ID:", room.deck_id);
                                
                                const judge = players.find(p => p.is_judge);
                                console.log("Found judge:", judge);
                                
                                if (!judge) {
                                  // If no judge, make first player judge
                                  if (players.length > 0) {
                                    await supabase
                                      .from("room_players")
                                      .update({ is_judge: true })
                                      .eq("room_id", roomId)
                                      .eq("profile_id", players[0].profile_id);
                                    
                                    await loadPlayers(); // Reload to get updated judge status
                                    const updatedJudge = players[0];
                                    console.log("Set judge to:", updatedJudge);
                                    
                                    await startNewRound(roomId, room.deck_id, updatedJudge.profile_id);
                                  } else {
                                    throw new Error("No players found");
                                  }
                                } else {
                                  await startNewRound(roomId, room.deck_id, judge.profile_id);
                                }
                                
                                setTimeout(() => {
                                  loadCurrentRound();
                                  loadPlayers();
                                }, 1000);
                                
                                setError("Round started manually!");
                              } catch (err) {
                                console.error("Manual round start error:", err);
                                setError("Failed to start round: " + err.message);
                              }
                            }}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
                          >
                            Force Start Round
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                        {playerHand.map((handCard) => (
                          <div
                            key={handCard.id}
                            className="relative group"
                          >
                            <button
                              onClick={() => handleSubmitCard(handCard.white_card_id)}
                              disabled={submissions.some(s => s.profile_id === user.id)}
                              className="w-full bg-white text-black p-4 rounded-lg text-left hover:bg-gray-100 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg border-2 border-gray-200 hover:border-blue-300 min-h-[120px] flex items-center justify-center"
                            >
                              <span className="text-sm font-medium leading-tight">
                                {handCard.white_cards?.text}
                              </span>
                            </button>
                            {!submissions.some(s => s.profile_id === user.id) && (
                              <div className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                Click to play
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {submissions.some(s => s.profile_id === user.id) && (
                      <div className="text-center">
                        <div className="inline-flex items-center gap-2 bg-emerald-900/50 text-emerald-400 px-4 py-2 rounded-lg">
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Card submitted! Waiting for other players...
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Judge View */}
                {room.status === "playing" && players.find(p => p.profile_id === user.id)?.is_judge && (
                  <div>
                    <div className="text-center mb-6">
                      <div className="inline-flex items-center gap-2 bg-purple-900/50 text-purple-400 px-4 py-2 rounded-lg">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        You are the Judge
                      </div>
                      <p className="text-zinc-400 mt-2">
                        Waiting for {players.filter(p => !p.is_judge).length - submissions.length} more players to submit cards
                      </p>
                    </div>

                    {submissions.length === players.filter(p => !p.is_judge).length ? (
                      <div>
                        <h4 className="font-bold text-center mb-4 text-lg">Choose the Winning Card:</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {submissions.map((submission, index) => (
                            <div key={submission.id} className="relative group">
                            <button
                              onClick={() => handleSelectWinner(submission.id)}
                              className="w-full bg-white text-black p-4 rounded-lg text-left hover:bg-yellow-100 transition-all transform hover:scale-105 shadow-lg border-2 border-gray-200 hover:border-yellow-400 min-h-[120px] flex items-center justify-center"
                            >
                                <span className="text-sm font-medium leading-tight">
                                  {submission.white_cards?.text}
                                </span>
                              </button>
                              <div className="absolute -top-2 -left-2 bg-gray-700 text-white text-xs px-2 py-1 rounded-full">
                                #{index + 1}
                              </div>
                              <div className="absolute -top-2 -right-2 bg-yellow-500 text-black text-xs px-2 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                Pick Winner
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mb-4"></div>
                        <p className="text-zinc-400">Waiting for players to submit their cards...</p>
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
          <div className="bg-zinc-900/50 rounded-xl p-4 h-96 flex flex-col">
            <h2 className="font-bold mb-4">Chat</h2>
            
            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {messages.map((message) => (
                <div key={message.id} className="text-sm">
                  <span className="font-medium text-zinc-300">
                    {message.profiles?.username || "Unknown"}:
                  </span>
                  <span className="ml-2 text-zinc-100">
                    {message.content}
                  </span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Send Message */}
            <form onSubmit={sendMessage} className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm focus:border-zinc-500 outline-none"
                maxLength={200}
              />
              <button
                type="submit"
                disabled={!newMessage.trim()}
                className="px-3 py-1 bg-blue-600 rounded text-sm hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 bg-red-950/90 border border-red-900 rounded-lg px-4 py-3 text-red-200 max-w-md">
          {error}
          <button
            onClick={() => setError("")}
            className="ml-2 text-red-400 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
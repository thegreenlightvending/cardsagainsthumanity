import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { ensureUserProfile } from "../utils/profileUtils";
import { startGame, submitCard, selectWinner } from "../utils/gameUtils";

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
      
      setError("Game started! First round beginning...");
      
      // Reload all game data
      setTimeout(() => {
        loadRoomData();
        loadCurrentRound();
        loadPlayerHand();
      }, 1000);
    } catch (err) {
      console.error("Game start error:", err);
      setError("Failed to start game: " + err.message);
    }
  }

  async function loadCurrentRound() {
    try {
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
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setCurrentRound(data);
    } catch (err) {
      console.error("Failed to load current round:", err);
    }
  }

  async function loadPlayerHand() {
    try {
      const { data, error } = await supabase
        .from("player_hands")
        .select(`
          *,
          white_cards(text)
        `)
        .eq("room_id", roomId)
        .eq("profile_id", user.id);

      if (error) throw error;
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
      await submitCard(currentRound.id, user.id, whiteCardId);
      setError("Card submitted!");
      loadPlayerHand();
      loadSubmissions();
    } catch (err) {
      setError("Failed to submit card: " + err.message);
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
                {/* Current Round */}
                {currentRound && (
                  <div className="text-center">
                    <div className="bg-zinc-800 rounded-lg p-4 mb-4">
                      <h3 className="text-lg font-bold mb-2">Black Card</h3>
                      <p className="text-xl">{currentRound.black_cards?.text}</p>
                      <p className="text-sm text-zinc-400 mt-2">
                        Judge: {currentRound.profiles?.username}
                      </p>
                    </div>

                    {/* Submissions Status */}
                    <p className="text-zinc-400 mb-4">
                      {submissions.length} / {players.filter(p => !p.is_judge).length} cards submitted
                    </p>
                  </div>
                )}

                {/* Player Hand (if not judge) */}
                {currentRound && !players.find(p => p.profile_id === user.id)?.is_judge && (
                  <div>
                    <h3 className="font-bold mb-3">Your Cards</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {playerHand.map((handCard) => (
                        <button
                          key={handCard.id}
                          onClick={() => handleSubmitCard(handCard.white_card_id)}
                          disabled={submissions.some(s => s.profile_id === user.id)}
                          className="bg-white text-black p-3 rounded-lg text-left hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {handCard.white_cards?.text}
                        </button>
                      ))}
                    </div>
                    {submissions.some(s => s.profile_id === user.id) && (
                      <p className="text-emerald-400 text-center mt-3">
                        ✓ Card submitted! Waiting for other players...
                      </p>
                    )}
                  </div>
                )}

                {/* Judge View */}
                {currentRound && players.find(p => p.profile_id === user.id)?.is_judge && (
                  <div>
                    <h3 className="font-bold mb-3">You are the Judge</h3>
                    <p className="text-zinc-400 mb-4">
                      Wait for all players to submit their cards, then choose the winner.
                    </p>
                    {submissions.length === players.filter(p => !p.is_judge).length && (
                      <div className="space-y-3">
                        <h4 className="font-bold">Choose the winning card:</h4>
                        {submissions.map((submission) => (
                          <button
                            key={submission.id}
                            onClick={() => selectWinner(currentRound.id, submission.id, user.id)}
                            className="block w-full bg-white text-black p-3 rounded-lg text-left hover:bg-gray-100 transition-colors"
                          >
                            {submission.white_cards?.text}
                          </button>
                        ))}
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
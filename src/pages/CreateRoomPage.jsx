import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { ensureUserProfile } from "../utils/profileUtils";

export default function CreateRoomPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }
  const [decks, setDecks] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [password, setPassword] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [turnTimer, setTurnTimer] = useState(60);
  const [useTimer, setUseTimer] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadDecks();
  }, []);

  async function loadDecks() {
    try {
      const { data, error } = await supabase
        .from("decks")
        .select("*")
        .order("name");
      
      if (error) throw error;
      setDecks(data || []);
      if (data?.length > 0) {
        setSelectedDeck(data[0].id.toString());
      }
    } catch (err) {
      setError("Failed to load decks");
    }
  }

  async function createRoom(e) {
    e.preventDefault();
    if (!selectedDeck) {
      setError("Please select a deck");
      return;
    }

    setError("");
    setBusy(true);

    try {
      // First ensure user has a profile
      await ensureUserProfile(user);

      // Create the room
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .insert({
          party_leader: user.id,
          deck_id: parseInt(selectedDeck),
          is_private: isPrivate,
          password: isPrivate ? password.toUpperCase() : null, // Store room code in uppercase
          max_players: maxPlayers,
          turn_timer_seconds: useTimer ? turnTimer : null
        })
        .select()
        .single();

      if (roomError) throw roomError;

      // Add creator as first player
      const { error: playerError } = await supabase
        .from("room_players")
        .insert({
          room_id: room.id,
          profile_id: user.id
        });

      if (playerError) throw playerError;

      // Navigate to the room
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(err.message || "Failed to create room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-black">Create Room</h1>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            Back
          </button>
        </div>

        <form onSubmit={createRoom} className="space-y-6">
          {/* Deck Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Deck</label>
            <select
              value={selectedDeck}
              onChange={(e) => setSelectedDeck(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 focus:border-zinc-500 outline-none"
              required
            >
              <option value="">Select a deck...</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name} ({deck.type})
                </option>
              ))}
            </select>
          </div>

          {/* Privacy Settings */}
          <div>
            <label className="block text-sm font-medium mb-2">Room Type</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  checked={!isPrivate}
                  onChange={() => setIsPrivate(false)}
                  className="mr-2"
                />
                Public Match
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  checked={isPrivate}
                  onChange={() => setIsPrivate(true)}
                  className="mr-2"
                />
                Private Room
              </label>
            </div>
          </div>

          {/* Room Code/Password (if private) */}
          {isPrivate && (
            <div>
              <label className="block text-sm font-medium mb-2">Room Code</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 focus:border-zinc-500 outline-none"
                placeholder="Enter a room code (e.g., PARTY123)..."
                required={isPrivate}
                maxLength={20}
                pattern="[A-Za-z0-9]+"
                title="Room code should only contain letters and numbers"
              />
              <p className="text-xs text-zinc-400 mt-1">
                This will be your room code that others use to join
              </p>
            </div>
          )}

          {/* Max Players */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Max Players: {maxPlayers}
            </label>
            <input
              type="range"
              min="3"
              max="10"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Turn Timer */}
          <div>
            <label className="flex items-center mb-2">
              <input
                type="checkbox"
                checked={useTimer}
                onChange={(e) => setUseTimer(e.target.checked)}
                className="mr-2"
              />
              Use Turn Timer
            </label>
            {useTimer && (
              <div>
                <label className="block text-sm text-zinc-300 mb-1">
                  Timer: {turnTimer} seconds
                </label>
                <input
                  type="range"
                  min="30"
                  max="300"
                  step="15"
                  value={turnTimer}
                  onChange={(e) => setTurnTimer(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-900 rounded-lg px-4 py-3 text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-emerald-500 text-emerald-950 font-bold py-3 rounded-lg hover:bg-emerald-400 transition-colors disabled:opacity-50"
          >
            {busy ? "Creating..." : "Create Room"}
          </button>
        </form>
      </div>
    </div>
  );
}
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";

export default function JoinRoomPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }
  const [publicRooms, setPublicRooms] = useState([]);
  const [roomCode, setRoomCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublicRooms();
  }, []);

  async function loadPublicRooms() {
    try {
      const { data, error } = await supabase
        .from("rooms")
        .select(`
          *,
          decks(name, type),
          room_players(profile_id),
          profiles!party_leader(username)
        `)
        .eq("is_private", false)
        .eq("status", "waiting")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPublicRooms(data || []);
    } catch (err) {
      setError("Failed to load public rooms");
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom(roomId, requiresPassword = false) {
    setError("");
    setBusy(true);

    try {
      // Ensure user has a profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .single();

      if (profileError && profileError.code === 'PGRST116') {
        const { error: insertError } = await supabase
          .from("profiles")
          .insert({
            id: user.id,
            username: user.user_metadata?.username || user.email?.split('@')[0] || 'Player',
            is_guest: user.is_anonymous || false
          });
        
        if (insertError) throw insertError;
      } else if (profileError) {
        throw profileError;
      }

      // Check if room exists and get details
      let query = supabase
        .from("rooms")
        .select(`
          *,
          room_players(profile_id)
        `)
        .eq("status", "waiting");

      if (roomId) {
        query = query.eq("id", roomId);
      } else {
        // Join by room code logic would go here
        throw new Error("Room code joining not implemented yet");
      }

      const { data: rooms, error: roomError } = await query;
      if (roomError) throw roomError;
      if (!rooms || rooms.length === 0) {
        throw new Error("Room not found or no longer available");
      }

      const room = rooms[0];

      // Check if room is full
      if (room.room_players.length >= room.max_players) {
        throw new Error("Room is full");
      }

      // Check if already in room
      if (room.room_players.some(p => p.profile_id === user.id)) {
        navigate(`/room/${room.id}`);
        return;
      }

      // Password validation is handled in joinByCode for private rooms

      // Join the room
      const { error: joinError } = await supabase
        .from("room_players")
        .insert({
          room_id: room.id,
          profile_id: user.id
        });

      if (joinError) throw joinError;

      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(err.message || "Failed to join room");
    } finally {
      setBusy(false);
    }
  }

  async function joinByCode(e) {
    e.preventDefault();
    if (!roomCode.trim()) {
      setError("Please enter a room code");
      return;
    }

    try {
      // Find room by password (room code)
      const { data: rooms, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("password", roomCode.trim())
        .eq("is_private", true)
        .eq("status", "waiting");

      if (error) throw error;
      if (!rooms || rooms.length === 0) {
        throw new Error("Room not found. Check your room code.");
      }
      
      const room = rooms[0];
      await joinRoom(room.id, false); // Don't need password check since we found by password
    } catch (err) {
      setError(err.message || "Failed to find room");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center">
        <div className="text-xl">Loading rooms...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-black">Join Room</h1>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            Back
          </button>
        </div>

        {/* Join by Room Code */}
        <div className="bg-zinc-900/50 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Join Private Room</h2>
          <form onSubmit={joinByCode} className="flex gap-4">
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="Enter room code (e.g., PARTY123)..."
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 focus:border-zinc-500 outline-none"
              maxLength={20}
            />
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-2 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              Join
            </button>
          </form>
          <p className="text-xs text-zinc-400 mt-2">
            The room code is the same as the room password
          </p>
        </div>

        {/* Public Rooms */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Public Rooms</h2>
            <button
              onClick={loadPublicRooms}
              className="px-3 py-1 bg-zinc-800 rounded text-sm hover:bg-zinc-700 transition-colors"
            >
              Refresh
            </button>
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-900 rounded-lg px-4 py-3 text-red-200 mb-4">
              {error}
            </div>
          )}

          {publicRooms.length === 0 ? (
            <div className="bg-zinc-900/50 rounded-xl p-8 text-center text-zinc-400">
              No public rooms available. Create one to get started!
            </div>
          ) : (
            <div className="grid gap-4">
              {publicRooms.map((room) => (
                <div
                  key={room.id}
                  className="bg-zinc-900/50 rounded-xl p-6 border border-zinc-800 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold">
                          {room.profiles?.username || "Unknown"}'s Room
                        </h3>
                        <span className="px-2 py-1 bg-zinc-800 rounded text-xs">
                          {room.decks?.name} ({room.decks?.type})
                        </span>
                      </div>
                      <div className="text-sm text-zinc-400">
                        {room.room_players?.length || 0} / {room.max_players} players
                        {room.turn_timer_seconds && (
                          <span className="ml-3">
                            ⏱️ {room.turn_timer_seconds}s timer
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => joinRoom(room.id)}
                      disabled={busy || (room.room_players?.length || 0) >= room.max_players}
                      className="px-4 py-2 bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {(room.room_players?.length || 0) >= room.max_players ? "Full" : "Join"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
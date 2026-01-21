import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";

export default function HomePage() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      {/* Header */}
      <div className="bg-zinc-900/50 border-b border-zinc-800 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-black">CAH Online</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400">
              {session?.user?.email || `User ${session?.user?.id?.slice(0, 8)}`}
            </span>
            <button
              onClick={signOut}
              className="px-3 py-1 bg-red-600 rounded text-sm hover:bg-red-500 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-black mb-4">Ready to Play?</h2>
          <p className="text-xl text-zinc-400">
            Create a private room with friends or join a public match
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-2xl mx-auto">
          {/* Create Room */}
          <div className="bg-zinc-900/50 rounded-2xl p-8 border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Create Room</h3>
              <p className="text-zinc-400 mb-6">
                Start a new game with custom settings. Choose your deck, set a password, and invite friends.
              </p>
              <button
                onClick={() => navigate("/create-room")}
                className="w-full bg-emerald-600 text-white font-bold py-3 rounded-lg hover:bg-emerald-500 transition-colors"
              >
                Create Room
              </button>
            </div>
          </div>

          {/* Join Room */}
          <div className="bg-zinc-900/50 rounded-2xl p-8 border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">Join Room</h3>
              <p className="text-zinc-400 mb-6">
                Join an existing game using a room code or browse public matches looking for players.
              </p>
              <button
                onClick={() => navigate("/join-room")}
                className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-500 transition-colors"
              >
                Join Room
              </button>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-16 text-center">
          <div className="grid grid-cols-3 gap-8 max-w-md mx-auto">
            <div>
              <div className="text-2xl font-bold text-emerald-400">2</div>
              <div className="text-sm text-zinc-500">Deck Types</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">3-10</div>
              <div className="text-sm text-zinc-500">Players</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-400">∞</div>
              <div className="text-sm text-zinc-500">Laughs</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


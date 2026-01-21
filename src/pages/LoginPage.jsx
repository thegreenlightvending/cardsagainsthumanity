import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState("login"); // login | signup
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onLogin(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;
      navigate("/");
    } catch (err) {
      setError(err?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSignup(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username },
        },
      });
      if (signUpError) throw signUpError;
      navigate("/");
    } catch (err) {
      setError(err?.message ?? "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  async function onGuest() {
    setError("");
    setBusy(true);
    try {
      // Supabase supports anonymous auth if enabled in your project.
      const { error: guestError } = await supabase.auth.signInAnonymously();
      if (guestError) throw guestError;
      navigate("/");
    } catch (err) {
      setError(err?.message ?? "Guest login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
        <h1 className="text-2xl font-black tracking-tight">CAH Online</h1>
        <p className="mt-1 text-sm text-zinc-300">
          Log in, sign up, or continue as a guest.
        </p>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              mode === "login" ? "bg-zinc-50 text-zinc-900" : "bg-zinc-800"
            }`}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              mode === "signup" ? "bg-zinc-50 text-zinc-900" : "bg-zinc-800"
            }`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={mode === "login" ? onLogin : onSignup}
        >
          {mode === "signup" && (
            <div>
              <label className="text-sm text-zinc-200">Username</label>
              <input
                className="mt-1 w-full rounded-lg bg-zinc-950/60 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-500"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="party-animal-123"
                autoComplete="nickname"
                required
              />
            </div>
          )}

          <div>
            <label className="text-sm text-zinc-200">Email</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-950/60 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="text-sm text-zinc-200">Password</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-950/60 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <button
            className="w-full rounded-lg bg-emerald-500 text-emerald-950 px-3 py-2 font-bold disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <div className="mt-4">
          <button
            className="w-full rounded-lg bg-zinc-800 px-3 py-2 font-semibold disabled:opacity-60"
            disabled={busy}
            onClick={onGuest}
          >
            Continue as guest
          </button>
          <p className="mt-2 text-xs text-zinc-400">
            Guest mode requires Supabase anonymous auth enabled.
          </p>
        </div>
      </div>
    </div>
  );
}


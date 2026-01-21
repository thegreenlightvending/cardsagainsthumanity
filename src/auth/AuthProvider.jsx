import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function init() {
      const { data, error } = await supabase.auth.getSession();
      if (!ignore) {
        if (error) console.error(error);
        setSession(data.session ?? null);
        setLoading(false);
      }
    }

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession ?? null);
        setLoading(false);
      },
    );

    return () => {
      ignore = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ 
    session, 
    user: session?.user || null,
    loading,
    signOut: () => supabase.auth.signOut()
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider />");
  return ctx;
}


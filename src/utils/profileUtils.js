import { supabase } from "../lib/supabase";

export async function ensureUserProfile(user) {
  if (!user) return null;

  try {
    // Check if profile exists
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError && profileError.code === 'PGRST116') {
      // Profile doesn't exist, create it
      const username = generateUsername(user);
      
      const { data: newProfile, error: insertError } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          username: username,
          is_guest: user.is_anonymous || false
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return newProfile;
    } else if (profileError) {
      throw profileError;
    }

    return profile;
  } catch (error) {
    console.error("Error ensuring user profile:", error);
    throw error;
  }
}

function generateUsername(user) {
  // Try different sources for username
  if (user.user_metadata?.username) {
    return user.user_metadata.username;
  }
  
  if (user.email) {
    const emailPart = user.email.split('@')[0];
    return emailPart;
  }
  
  if (user.user_metadata?.full_name) {
    return user.user_metadata.full_name.replace(/\s+/g, '');
  }
  
  // Fallback to a random player name
  const randomNum = Math.floor(Math.random() * 1000);
  return `Player${randomNum}`;
}
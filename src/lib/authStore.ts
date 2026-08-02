import { create } from "zustand";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import type { Role } from "./types";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  role: Role | "pending";
}

interface AuthState {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  error: string;

  init: () => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const useAuth = create<AuthState>()((set, get) => ({
  loading: true,
  userId: null,
  profile: null,
  error: "",

  init: () => {
    if (!supabase) return set({ loading: false });
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id ?? null;
      set({ userId: uid, loading: false });
      if (uid) void get().refreshProfile();
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null;
      set({ userId: uid });
      if (uid) void get().refreshProfile();
      else set({ profile: null });
    });
  },

  refreshProfile: async () => {
    if (!supabase) return;
    const uid = get().userId;
    if (!uid) return;
    const { data } = await supabase.from("profiles").select("id,email,display_name,role").eq("id", uid).maybeSingle();
    set({ profile: (data as Profile) ?? null });
  },

  signIn: async (email, password) => {
    if (!supabase) return "Supabase is not configured.";
    set({ error: "" });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: error.message });
      return error.message;
    }
    return null;
  },

  signUp: async (email, password, displayName) => {
    if (!supabase) return "Supabase is not configured.";
    set({ error: "" });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) {
      set({ error: error.message });
      return error.message;
    }
    return null;
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ userId: null, profile: null });
  },
}));

export { isSupabaseConfigured };

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
  // True once Supabase confirms the visitor arrived via a password-reset
  // email link — App.tsx shows the "set a new password" screen instead of
  // the normal sign-in/workspace routing while this is set.
  passwordRecovery: boolean;

  init: () => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, displayName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (newPassword: string) => Promise<string | null>;
}

/** Pull a readable message out of whatever Supabase (or a network failure) gave us. */
function readableError(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object" && e !== null) {
    const anyE = e as { message?: string; error_description?: string; msg?: string; status?: number; name?: string };
    const msg = anyE.message || anyE.error_description || anyE.msg;
    if (msg && msg.trim() && msg !== "{}") return msg;
    if (anyE.status) return `Request failed (HTTP ${anyE.status}). Check Supabase Auth logs for details.`;
  }
  return "Something went wrong talking to the server. Please try again in a moment.";
}

export const useAuth = create<AuthState>()((set, get) => ({
  loading: true,
  userId: null,
  profile: null,
  error: "",
  passwordRecovery: false,

  init: () => {
    if (!supabase) return set({ loading: false });
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id ?? null;
      set({ userId: uid, loading: false });
      if (uid) void get().refreshProfile();
    });
    supabase.auth.onAuthStateChange((event, session) => {
      const uid = session?.user.id ?? null;
      set({ userId: uid });
      if (event === "PASSWORD_RECOVERY") set({ passwordRecovery: true });
      if (uid) void get().refreshProfile();
      else set({ profile: null });
    });
  },

  refreshProfile: async () => {
    if (!supabase) return;
    const uid = get().userId;
    if (!uid) return;
    const { data, error } = await supabase.from("profiles").select("id,email,display_name,role").eq("id", uid).maybeSingle();
    if (error) console.error("refreshProfile failed:", error);
    set({ profile: (data as Profile) ?? null });
  },

  signIn: async (email, password) => {
    if (!supabase) return "Supabase is not configured.";
    set({ error: "" });
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        console.error("signIn error:", error);
        const msg = readableError(error);
        set({ error: msg });
        return msg;
      }
      return null;
    } catch (e) {
      console.error("signIn threw:", e);
      const msg = readableError(e);
      set({ error: msg });
      return msg;
    }
  },

  signUp: async (email, password, displayName) => {
    if (!supabase) return "Supabase is not configured.";
    set({ error: "" });
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) {
        console.error("signUp error:", error);
        const msg = readableError(error);
        set({ error: msg });
        return msg;
      }
      return null;
    } catch (e) {
      console.error("signUp threw:", e);
      const msg = readableError(e);
      set({ error: msg });
      return msg;
    }
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ userId: null, profile: null, passwordRecovery: false });
  },

  requestPasswordReset: async (email) => {
    if (!supabase) return "Supabase is not configured.";
    set({ error: "" });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) {
        console.error("requestPasswordReset error:", error);
        const msg = readableError(error);
        set({ error: msg });
        return msg;
      }
      return null;
    } catch (e) {
      console.error("requestPasswordReset threw:", e);
      const msg = readableError(e);
      set({ error: msg });
      return msg;
    }
  },

  updatePassword: async (newPassword) => {
    if (!supabase) return "Supabase is not configured.";
    set({ error: "" });
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        console.error("updatePassword error:", error);
        const msg = readableError(error);
        set({ error: msg });
        return msg;
      }
      set({ passwordRecovery: false });
      return null;
    } catch (e) {
      console.error("updatePassword threw:", e);
      const msg = readableError(e);
      set({ error: msg });
      return msg;
    }
  },
}));

export { isSupabaseConfigured };

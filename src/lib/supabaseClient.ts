import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Reads Supabase creds from Vite env. If absent, the app runs in LOCAL mode
// (browser-only persistence) so it works with zero backend setup.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;

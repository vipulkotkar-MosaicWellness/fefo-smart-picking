import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Supabase connection. Env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
// override the built-in defaults below.
//
// The publishable ("anon") key is safe to ship in client code: it is public by
// design, and Row Level Security limits it to READ-ONLY access to the stock
// table. All writes use the secret key, which lives only in the Apps Script.
const DEFAULT_URL = "https://kytktvvcbgslwokywmds.supabase.co";
const DEFAULT_ANON_KEY = "sb_publishable_GR8Q2KWOG0TuYBhV06MRmg_MgqJsTjh";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_URL;
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url, anonKey) : null;

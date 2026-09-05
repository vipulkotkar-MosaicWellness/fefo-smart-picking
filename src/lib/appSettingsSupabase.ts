import { supabase } from "./supabaseClient";

/** Reads one shared app setting by key. undefined if unset or Supabase isn't configured. */
export async function fetchSetting(key: string): Promise<unknown | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value;
}

/** Super Admin only (enforced by RLS, not just the UI) — see schema_app_settings.sql. */
export async function upsertSetting(key: string, value: unknown, updatedBy: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_by: updatedBy, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

/** Refetch-on-any-change, same pattern as subscribeChannelOverrides. */
export function subscribeSettings(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("app-settings-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

import { supabase } from "./supabaseClient";

interface PickerRow {
  name: string;
}

export async function fetchPickers(): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("pickers").select("name").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => (r as PickerRow).name);
}

export async function insertPicker(name: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("pickers").insert({ name });
  if (error) throw error;
}

export async function renamePickerRow(oldName: string, newName: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("pickers").update({ name: newName }).eq("name", oldName);
  if (error) throw error;
}

export async function deletePickerRow(name: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("pickers").delete().eq("name", name);
  if (error) throw error;
}

/** Refetch-on-any-change — the list is small, so a full reload is simpler than diffing rows. */
export function subscribePickers(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("pickers-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "pickers" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

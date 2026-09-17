import { supabase } from "./supabaseClient";

export interface CaseSizeRow {
  sku: string;
  case_size: number;
}

/**
 * Builds a plain sku -> case size lookup from the raw rows. A case_size of
 * 0 or 1 is treated as "not set" (nothing meaningful to show/allocate as a
 * case) — same convention as everywhere else in this feature. Pure/testable
 * without a live Supabase connection, same shape as applyChannelOverrides.
 */
export function applyCaseSizeRows(rows: CaseSizeRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.case_size > 1) out[r.sku] = r.case_size;
  }
  return out;
}

export async function fetchCaseSizes(): Promise<CaseSizeRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("case_sizes").select("sku,case_size");
  if (error) throw error;
  return (data ?? []) as CaseSizeRow[];
}

export async function upsertCaseSize(sku: string, caseSize: number): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("case_sizes").upsert({ sku, case_size: caseSize }, { onConflict: "sku" });
  if (error) throw error;
}

export async function deleteCaseSize(sku: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("case_sizes").delete().eq("sku", sku);
  if (error) throw error;
}

/** Refetch-on-any-change — same pattern as subscribeChannelOverrides/subscribePickers. */
export function subscribeCaseSizes(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("case-sizes-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "case_sizes" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

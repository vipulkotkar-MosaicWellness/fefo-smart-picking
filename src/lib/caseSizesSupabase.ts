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

export interface CaseSizeGapRow {
  sku: string;
  first_seen_at: string;
  last_seen_at: string;
  occurrences: number;
  total_qty: number;
}

/**
 * Logs one gap occurrence per SKU for a batch of demand lines that had no
 * configured case size — called from generate() for a REAL order only,
 * never from a preview, so this table only ever reflects orders that
 * actually happened. Reads any existing row first and adds onto it
 * (occurrences/total_qty accumulate, first_seen_at is preserved) rather
 * than overwriting — this is a running count, not a snapshot. Concurrent
 * calls for the same SKU can race (read-then-upsert, no DB-side atomic
 * increment) and under-count; acceptable since this only feeds an Admin
 * analytics dashboard, not anything that gates picking.
 */
export async function logCaseSizeGaps(occurrences: { sku: string; qty: number }[]): Promise<void> {
  if (!supabase || occurrences.length === 0) return;
  const skus = [...new Set(occurrences.map((o) => o.sku))];
  const { data, error: fetchError } = await supabase.from("case_size_gaps").select("sku,first_seen_at,occurrences,total_qty").in("sku", skus);
  if (fetchError) throw fetchError;
  // Not cast to CaseSizeGapRow: that select omits last_seen_at, and a full-interface cast would
  // dishonestly claim it's present.
  const existing = new Map((data ?? []).map((r) => [r.sku, r as Pick<CaseSizeGapRow, "sku" | "first_seen_at" | "occurrences" | "total_qty">] as const));
  const now = new Date().toISOString();
  const bySku = new Map<string, { qty: number; count: number }>();
  for (const o of occurrences) {
    const cur = bySku.get(o.sku) ?? { qty: 0, count: 0 };
    cur.qty += o.qty;
    cur.count += 1;
    bySku.set(o.sku, cur);
  }
  const rows = [...bySku.entries()].map(([sku, agg]) => {
    const prev = existing.get(sku);
    return {
      sku,
      first_seen_at: prev?.first_seen_at ?? now,
      last_seen_at: now,
      occurrences: (prev?.occurrences ?? 0) + agg.count,
      total_qty: (prev?.total_qty ?? 0) + agg.qty,
    };
  });
  const { error } = await supabase.from("case_size_gaps").upsert(rows, { onConflict: "sku" });
  if (error) throw error;
}

export async function fetchCaseSizeGaps(): Promise<CaseSizeGapRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("case_size_gaps").select("sku,first_seen_at,last_seen_at,occurrences,total_qty").order("total_qty", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CaseSizeGapRow[];
}

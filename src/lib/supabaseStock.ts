import type { ShelfwiseStockRow } from "./shelfwiseCsv";
import { supabase } from "./supabaseClient";
import type { SyncSource } from "./syncSource";
import type { Expiry, StockRow } from "./types";

function expFromDate(d: string | null): Expiry {
  if (!d) return [2099, 1];
  const [y, m] = d.split("-").map(Number);
  return [y, m];
}

interface StockRowDb {
  facility: string;
  bin: string;
  sku: string;
  name: string;
  batch: string | null;
  vendor_batch: string | null;
  expiry: string | null;
  qty: number;
  shelf: number;
}

/** Fetch all stock rows from Supabase, paging past the 1000-row default limit. */
export async function fetchStock(): Promise<StockRow[]> {
  if (!supabase) return [];
  const page = 1000;
  const all: StockRowDb[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("stock")
      .select("facility,bin,sku,name,batch,vendor_batch,expiry,qty,shelf")
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as StockRowDb[]));
    if (data.length < page) break;
  }
  return all.map((r, i) => ({
    rid: i + 1,
    location: r.facility,
    bin: r.bin,
    sku: r.sku,
    name: r.name,
    batch: r.batch ?? "-",
    vendorBatch: r.vendor_batch ?? undefined,
    exp: expFromDate(r.expiry),
    expDate: r.expiry ?? undefined,
    qty: r.qty,
    shelf: r.shelf,
    type: "Good",
    active: "Active",
  }));
}

/**
 * Per-facility last-synced time — since the ingest now replaces each
 * facility's stock rows independently (skipping only the ones frozen at
 * that moment), there's no longer one single "last synced" for the whole
 * feed. Backed by the facility_last_synced view (max(stock.updated_at)
 * grouped by facility) — see add_per_facility_feed_frozen.sql.
 */
export async function fetchFacilityLastSynced(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data, error } = await supabase.from("facility_last_synced").select("facility,last_synced");
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { facility: string; last_synced: string }[]) {
    out[row.facility] = row.last_synced;
  }
  return out;
}

export interface SyncStateInfo {
  lastSynced: string | null;
  source: SyncSource;
  updatedBy: string | null;
}

/** Last sync time + who/what last updated stock (email pipeline vs. a manual upload). */
export async function fetchSyncState(): Promise<SyncStateInfo> {
  if (!supabase) return { lastSynced: null, source: null, updatedBy: null };
  const { data } = await supabase.from("sync_state").select("last_synced,source,updated_by").eq("id", 1).maybeSingle();
  const row = data as { last_synced: string | null; source: string | null; updated_by: string | null } | null;
  return {
    lastSynced: row?.last_synced ?? null,
    source: (row?.source as SyncSource) ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

/**
 * Admin/Super Admin fallback for when the hourly Shelfwise pipeline is down:
 * wipes the shared `stock` table and reloads it from a manually-uploaded
 * export, then updates `sync_state` the same way the Apps Script does — so
 * every signed-in user sees the same fallback data, not just this browser.
 * Requires the "admin upload stock" / "admin clear stock" / "admin update
 * sync_state" RLS policies (Admin/Super Admin only) to be in place.
 */
export async function replaceStock(rows: ShelfwiseStockRow[], uploadedBy: string): Promise<void> {
  if (!supabase) return;
  const { error: delError } = await supabase.from("stock").delete().gte("id", 0);
  if (delError) throw delError;

  const page = 500;
  for (let from = 0; from < rows.length; from += page) {
    const chunk = rows.slice(from, from + page);
    const { error } = await supabase.from("stock").insert(chunk);
    if (error) throw error;
  }

  const { error: syncError } = await supabase
    .from("sync_state")
    .update({ last_synced: new Date().toISOString(), rows: rows.length, status: "ok", source: "manual", updated_by: uploadedBy })
    .eq("id", 1);
  if (syncError) throw syncError;
}

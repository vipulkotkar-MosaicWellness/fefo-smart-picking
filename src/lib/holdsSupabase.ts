import { supabase } from "./supabaseClient";
import type { Hold } from "./types";

interface HoldRow {
  id: number;
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  qty: number;
  held_at: string;
  held_by: string;
  reason: string | null;
  source_task_no: string | null;
  released_at: string | null;
  released_by: string | null;
}

function fromRow(r: HoldRow): Hold {
  return {
    id: r.id,
    sku: r.sku,
    facility: r.facility,
    bin: r.bin,
    batch: r.batch,
    qty: r.qty,
    heldAt: r.held_at,
    heldBy: r.held_by,
    reason: r.reason ?? undefined,
    sourceTaskNo: r.source_task_no ?? undefined,
    releasedAt: r.released_at ?? undefined,
    releasedBy: r.released_by ?? undefined,
  };
}

/**
 * Every hold, active and released — callers filter for active client-side.
 * Paged past PostgREST's silent 1000-row default (same loop as fetchStock in
 * supabaseStock.ts): this is ordered held_at DESCENDING, so an un-paged fetch
 * drops the OLDEST holds — the ones the aging pivot's "> 10 days" bucket
 * exists to surface, and whose keys activeHoldKeys() feeds into allocate().
 * A hold that falls off the end silently stops blocking its lot.
 */
export async function fetchHolds(): Promise<Hold[]> {
  if (!supabase) return [];
  const page = 1000;
  const all: HoldRow[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("stock_holds")
      .select("*")
      .order("held_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as HoldRow[]));
    if (data.length < page) break;
  }
  return all.map(fromRow);
}

export interface NewHold {
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  qty: number;
  heldBy: string;
  reason?: string;
  sourceTaskNo?: string;
}

export async function insertHold(h: NewHold): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("stock_holds").insert({
    sku: h.sku,
    facility: h.facility,
    bin: h.bin,
    batch: h.batch,
    qty: h.qty,
    held_by: h.heldBy,
    reason: h.reason ?? null,
    source_task_no: h.sourceTaskNo ?? null,
  });
  if (error) throw error;
}

export async function releaseHoldRow(id: number, releasedBy: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("stock_holds")
    .update({ released_at: new Date().toISOString(), released_by: releasedBy })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Live updates: fires whenever ANY user places or releases a hold.
 * Refetch-on-any-change, the same pattern as subscribePickers /
 * subscribeChannelOverrides — the hold list is small enough that a full
 * reload beats diffing rows.
 *
 * Without this, holds were the one shared entity with no realtime feed:
 * loaded once at mount, then only after this device's own placeHold /
 * releaseHold (checkHoldAutoRelease returns before loadHolds() whenever
 * nothing is due, so the 60s timer is not a refresh path). A hold placed
 * elsewhere stayed invisible here indefinitely — and activeHoldKeys() feeds
 * allocate(), so this device kept offering held stock.
 *
 * Requires stock_holds to be in the supabase_realtime publication — see
 * supabase/add_stock_holds_realtime.sql.
 */
export function subscribeHolds(onChange: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("stock-holds-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "stock_holds" }, () => onChange())
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

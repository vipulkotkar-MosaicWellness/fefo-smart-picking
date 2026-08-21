import type { BinSkip, ChannelRule, Expiry, PickLine, StockRow } from "./types";
import { holdKey } from "./holds";

/** Remaining shelf life in whole months from `today` to expiry. */
export function monthsRemaining(exp: Expiry, today = new Date()): number {
  return (exp[0] - today.getFullYear()) * 12 + (exp[1] - 1 - today.getMonth());
}

/** Minimum remaining months a channel accepts, from its (configurable) rule. */
export function cutoffMonths(rule: ChannelRule, shelf: number): number {
  return rule.type === "fixed" ? rule.val : +(rule.val * shelf).toFixed(1);
}

/** Bins holding physically set-aside not-found/exception stock — never real pickable inventory. */
export function isExceptionBin(bin: string): boolean {
  return bin.trim().toUpperCase().includes("NTF");
}

/** Parse a bin code into [zone letter, position number] for path ordering. */
export function binKey(bin: string): [string, number] {
  const m = /([A-Za-z]+)-?([A-Za-z])(\d+)/.exec(bin) || /([A-Za-z])(\d+)/.exec(bin);
  if (!m) return [String(bin), 0];
  return [m[m.length - 2], Number(m[m.length - 1])];
}

/** Order pick lines by bin (zone then position) — the "critical path". */
export function criticalPathSort<T extends { bin: string }>(lines: T[]): T[] {
  return lines.slice().sort((a, b) => {
    const [za, na] = binKey(a.bin);
    const [zb, nb] = binKey(b.bin);
    return za < zb ? -1 : za > zb ? 1 : na - nb;
  });
}

export interface AllocateArgs {
  sku: string;
  need: number;
  // Omit to allocate purely by FEFO across every facility at once — the
  // default now that facility priority no longer drives allocation (see
  // store.ts). Pass a specific facility only when you deliberately want to
  // restrict the search to one location.
  location?: string;
  cutoff: number; // minimum remaining months (already computed from the channel rule)
  stock: StockRow[];
  // Keyed by sku+facility+bin+batch identity (see holdKey), NOT by the stock
  // row's rid — rid is reassigned on every resync and isn't safe to persist
  // reservations against.
  reservedFor: (key: string) => number;
  exclude?: number[];
  heldKeys?: Set<string>;
  today?: Date;
  // Minimum available qty a bin+batch must have to be offered at all — see
  // ChannelRule.minBinQty. Lots that clear the shelf-life cutoff but fall
  // under this floor are reported in `skipped` instead of being allocated.
  minQty?: number;
}

export interface AllocateResult {
  lines: PickLine[];
  short: number;
  any: boolean;
  skipped: BinSkip[];
}

/**
 * Allocate demand for one SKU: keep Good + Active stock, excluding
 * not-found exception bins (CC-NTF*), keep only batches meeting the channel
 * shelf-life cutoff, sort FEFO, and fill across bins using currently
 * available (un-reserved) qty. When `location` is omitted, every facility is
 * pooled together and sorted purely by expiry — the earliest-expiring
 * eligible lot wins regardless of which facility it happens to sit in, so a
 * single SKU's demand can legitimately split across facilities purely
 * because that's where the earliest stock physically is.
 */
export function allocate(args: AllocateArgs): AllocateResult {
  const { sku, need, location, cutoff, stock, reservedFor, minQty } = args;
  const exclude = args.exclude ?? [];
  const heldKeys = args.heldKeys;
  const today = args.today ?? new Date();

  const withinShelfLife = stock
    .filter(
      (b) =>
        b.sku === sku &&
        (location === undefined || b.location === location) &&
        b.type === "Good" &&
        b.active === "Active" &&
        !isExceptionBin(b.bin) &&
        !exclude.includes(b.rid) &&
        !(heldKeys?.has(holdKey(b.sku, b.location, b.bin, b.batch)) ?? false),
    )
    .map((b) => ({ b, rem: monthsRemaining(b.exp, today), av: b.qty - reservedFor(holdKey(b.sku, b.location, b.bin, b.batch)) }))
    .filter((o) => o.rem >= cutoff && o.av > 0)
    .sort((x, y) => x.rem - y.rem);

  const eligible = minQty ? withinShelfLife.filter((o) => o.av >= minQty) : withinShelfLife;
  const skipped: BinSkip[] = minQty
    ? withinShelfLife
        .filter((o) => o.av < minQty)
        .map((o) => ({ sku, name: o.b.name, facility: o.b.location, bin: o.b.bin, batch: o.b.batch, qtyAvailable: o.av, threshold: minQty }))
    : [];

  let remain = need;
  const lines: PickLine[] = [];
  for (const o of eligible) {
    if (remain <= 0) break;
    const take = Math.min(remain, o.av);
    lines.push({
      rid: o.b.rid,
      sku,
      name: o.b.name,
      facility: o.b.location,
      bin: o.b.bin,
      batch: o.b.batch,
      exp: o.b.exp,
      rem: o.rem,
      qty: take,
    });
    remain -= take;
  }
  return { lines, short: remain, any: eligible.length > 0, skipped };
}

import { CHANNELS } from "./channels";
import type { Expiry, PickLine, StockRow } from "./types";

/** Remaining shelf life in whole months from `today` to expiry. */
export function monthsRemaining(exp: Expiry, today = new Date()): number {
  return (exp[0] - today.getFullYear()) * 12 + (exp[1] - 1 - today.getMonth());
}

/** Minimum remaining months a channel accepts for a given total shelf life. */
export function cutoffMonths(channel: string, shelf: number): number {
  const r = CHANNELS[channel];
  if (!r) return 0;
  return r.type === "fixed" ? r.val : +(r.val * shelf).toFixed(1);
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
  channel: string;
  location: string;
  shelf: number;
  stock: StockRow[];
  reservedFor: (rid: number) => number;
  exclude?: number[];
  today?: Date;
}

export interface AllocateResult {
  lines: PickLine[];
  short: number;
  cut: number;
  any: boolean;
}

/**
 * Allocate demand for one SKU: keep Good + Active stock at the location,
 * keep only batches meeting the channel shelf-life rule, sort FEFO, and
 * fill the demand across bins using currently available (un-reserved) qty.
 */
export function allocate(args: AllocateArgs): AllocateResult {
  const { sku, need, channel, location, shelf, stock, reservedFor } = args;
  const exclude = args.exclude ?? [];
  const today = args.today ?? new Date();
  const cut = cutoffMonths(channel, shelf);

  const eligible = stock
    .filter(
      (b) =>
        b.sku === sku &&
        b.location === location &&
        b.type === "Good" &&
        b.active === "Active" &&
        !exclude.includes(b.rid),
    )
    .map((b) => ({ b, rem: monthsRemaining(b.exp, today), av: b.qty - reservedFor(b.rid) }))
    .filter((o) => o.rem >= cut && o.av > 0)
    .sort((x, y) => x.rem - y.rem);

  let remain = need;
  const lines: PickLine[] = [];
  for (const o of eligible) {
    if (remain <= 0) break;
    const take = Math.min(remain, o.av);
    lines.push({
      rid: o.b.rid,
      sku,
      name: o.b.name,
      bin: o.b.bin,
      batch: o.b.batch,
      exp: o.b.exp,
      rem: o.rem,
      qty: take,
    });
    remain -= take;
  }
  return { lines, short: remain, cut, any: eligible.length > 0 };
}

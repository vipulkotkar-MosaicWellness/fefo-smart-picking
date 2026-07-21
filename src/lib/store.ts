import { create } from "zustand";
import { persist } from "zustand/middleware";
import { allocate } from "./engine";
import { rowsFromTuples, SAMPLE_STOCK, type StockTuple } from "./sampleData";
import type { DemandLine, MasterPicklist, PickLine, SkuInfo, StockRow } from "./types";

/** Total qty reserved (soft-blocked) for a stock row across all OPEN picklists. */
export function reservedFor(picklists: MasterPicklist[], rid: number): number {
  let r = 0;
  for (const p of picklists) {
    if (p.status !== "open") continue;
    for (const l of p.lines) {
      if (l.rid === rid && !l.noElig && !l.shortLine) r += l.qty;
    }
  }
  return r;
}

function skusFromStock(stock: StockRow[]): Record<string, SkuInfo> {
  const s: Record<string, SkuInfo> = {};
  for (const b of stock) s[b.sku] = { name: b.name, shelf: b.shelf };
  return s;
}

export interface AppState {
  stock: StockRow[];
  skus: Record<string, SkuInfo>;
  location: string;
  channel: string;
  phase: 1 | 2;
  view: "operator" | "picker";
  demand: DemandLine[];
  picklists: MasterPicklist[];
  mplSeq: number;
  gpSeq: number;
  notice: string;

  locations: () => string[];
  anyOpen: () => boolean;
  setView: (v: "operator" | "picker") => void;

  loadStock: (tuples: StockTuple[]) => void;
  setLocation: (l: string) => void;
  setChannel: (c: string) => void;
  setPhase: (p: 1 | 2) => void;
  setDemand: (d: DemandLine[]) => void;
  removeDemand: (i: number) => void;
  generate: () => void;
  markCompleted: (no: string, nf: Record<number, number>) => void;
  setNotice: (s: string) => void;
}

function mplNumber(seq: number): string {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `MPL-${ymd}-${String(seq).padStart(3, "0")}`;
}

const initialStock = rowsFromTuples(SAMPLE_STOCK);

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      stock: initialStock,
      skus: skusFromStock(initialStock),
      location: initialStock[0]?.location ?? "",
      channel: "Blinkit",
      phase: 1,
      view: "operator",
      demand: [],
      picklists: [],
      mplSeq: 0,
      gpSeq: 0,
      notice: "",

      locations: () => [...new Set(get().stock.map((b) => b.location))],
      anyOpen: () => get().picklists.some((p) => p.status === "open"),
      setView: (v) => set({ view: v }),

      loadStock: (tuples) => {
        const stock = rowsFromTuples(tuples);
        const locs = [...new Set(stock.map((b) => b.location))];
        set({
          stock,
          skus: skusFromStock(stock),
          location: locs.includes(get().location) ? get().location : (locs[0] ?? ""),
          notice: `${stock.length} stock rows loaded across ${locs.length} location(s).`,
        });
      },

      setLocation: (l) => set({ location: l }),
      setChannel: (c) => set({ channel: c }),
      setPhase: (p) => set({ phase: p }),
      setDemand: (d) => set({ demand: d }),
      removeDemand: (i) => set({ demand: get().demand.filter((_, idx) => idx !== i) }),

      generate: () => {
        const { skus, demand, channel, location, stock, picklists, mplSeq } = get();
        if (Object.keys(skus).length === 0) return set({ notice: "Upload stock first." });
        if (demand.length === 0) return set({ notice: "Add demand first." });

        const seq = mplSeq + 1;
        const reserved = (rid: number) => reservedFor(picklists, rid);
        const lines: PickLine[] = [];
        for (const d of demand) {
          const r = allocate({
            sku: d.sku,
            need: d.qty,
            channel,
            location,
            shelf: skus[d.sku].shelf,
            stock,
            reservedFor: reserved,
          });
          if (r.lines.length === 0) {
            lines.push({ sku: d.sku, name: skus[d.sku].name, bin: "—", qty: 0, noElig: true });
          } else {
            lines.push(...r.lines);
            if (r.short > 0) {
              lines.push({ sku: d.sku, name: skus[d.sku].name, bin: "—", qty: r.short, shortLine: true });
            }
          }
        }
        const pl: MasterPicklist = {
          no: mplNumber(seq),
          channel,
          location,
          status: "open",
          bad: 0,
          demand: JSON.parse(JSON.stringify(demand)),
          lines,
        };
        set({ picklists: [...picklists, pl], mplSeq: seq, demand: [], notice: `${pl.no} generated — stock soft-blocked, feed frozen.` });
      },

      markCompleted: (no, nf) => {
        const state = get();
        const stock = state.stock.map((b) => ({ ...b }));
        let gpSeq = state.gpSeq;
        const picklists = state.picklists.map((pl) => {
          if (pl.no !== no || pl.status !== "open") return pl;
          let picked = 0;
          let bad = 0;
          const lines = pl.lines.map((l) => {
            if (l.noElig || l.shortLine || l.qty <= 0 || l.rid == null) return l;
            let n = nf[l.rid] ?? 0;
            if (isNaN(n) || n < 0) n = 0;
            if (n > l.qty) n = l.qty;
            const pk = l.qty - n;
            picked += pk;
            bad += n;
            const b = stock.find((x) => x.rid === l.rid);
            if (b) b.qty = Math.max(0, b.qty - pk);
            return { ...l, nf: n, picked: pk };
          });
          gpSeq += 1;
          return {
            ...pl,
            lines,
            bad,
            pickedTotal: picked,
            status: "completed" as const,
            gp: "GP-" + String(100000 + gpSeq * 137).slice(0, 6),
          };
        });
        set({ picklists, stock, gpSeq, notice: `${no} completed — gatepass raised, feed live.` });
      },

      setNotice: (s) => set({ notice: s }),
    }),
    { name: "fefo-smart-picking" },
  ),
);

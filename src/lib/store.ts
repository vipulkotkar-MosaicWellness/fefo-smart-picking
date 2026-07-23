import { create } from "zustand";
import { persist } from "zustand/middleware";
import { allocate } from "./engine";
import { FACILITY_PRIORITY, facilityCode } from "./facilities";
import { rowsFromTuples, SAMPLE_STOCK, type StockTuple } from "./sampleData";
import type {
  DemandLine,
  FacilityPicklist,
  PickingTask,
  PickLine,
  Shortfall,
  SkuInfo,
  StockRow,
} from "./types";

/** All facility picklists across all tasks (flattened). */
export function allFacilityLists(tasks: PickingTask[]): FacilityPicklist[] {
  return tasks.flatMap((t) => t.facilities);
}

/** Qty reserved (soft-blocked) for a stock row across all OPEN facility picklists. */
export function reservedFor(tasks: PickingTask[], rid: number): number {
  let r = 0;
  for (const f of allFacilityLists(tasks)) {
    if (f.status !== "open") continue;
    for (const l of f.lines) if (l.rid === rid) r += l.qty;
  }
  return r;
}

export function taskIsComplete(t: PickingTask): boolean {
  return t.facilities.length > 0 && t.facilities.every((f) => f.status === "completed");
}

function skusFromStock(stock: StockRow[]): Record<string, SkuInfo> {
  const s: Record<string, SkuInfo> = {};
  for (const b of stock) s[b.sku] = { name: b.name, shelf: b.shelf };
  return s;
}

function taskNumber(seq: number): string {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `PT-${ymd}-${String(seq).padStart(3, "0")}`;
}

export interface AppState {
  stock: StockRow[];
  skus: Record<string, SkuInfo>;
  location: string; // facility for the inventory VIEW only
  channel: string;
  phase: 1 | 2;
  view: "operator" | "picker";
  demand: DemandLine[];
  tasks: PickingTask[];
  taskSeq: number;
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
  markFacilityCompleted: (taskNo: string, facilityNo: string, nf: Record<number, number>) => void;
}

const initialStock = rowsFromTuples(SAMPLE_STOCK);

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      stock: initialStock,
      skus: skusFromStock(initialStock),
      location: FACILITY_PRIORITY[0],
      channel: "Blinkit",
      phase: 1,
      view: "operator",
      demand: [],
      tasks: [],
      taskSeq: 0,
      gpSeq: 0,
      notice: "",

      locations: () => [...new Set(get().stock.map((b) => b.location))],
      anyOpen: () => allFacilityLists(get().tasks).some((f) => f.status === "open"),
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

      // Waterfall allocation across facilities in priority order.
      generate: () => {
        const { skus, demand, channel, stock, tasks, taskSeq } = get();
        if (Object.keys(skus).length === 0) return set({ notice: "Upload stock first." });
        if (demand.length === 0) return set({ notice: "Add demand first." });

        const seq = taskSeq + 1;
        const no = taskNumber(seq);
        const reserved = (rid: number) => reservedFor(tasks, rid);

        const byFacility: Record<string, PickLine[]> = {};
        const shortfall: Shortfall[] = [];

        for (const d of demand) {
          let need = d.qty;
          for (const facility of FACILITY_PRIORITY) {
            if (need <= 0) break;
            const r = allocate({
              sku: d.sku,
              need,
              channel,
              location: facility,
              shelf: skus[d.sku].shelf,
              stock,
              reservedFor: reserved,
            });
            if (r.lines.length) {
              (byFacility[facility] ??= []).push(...r.lines);
              need = r.short;
            }
          }
          if (need > 0) shortfall.push({ sku: d.sku, name: skus[d.sku].name, qty: need });
        }

        const facilities: FacilityPicklist[] = FACILITY_PRIORITY.filter((f) => byFacility[f]?.length).map(
          (f) => ({
            no: `${no}-${facilityCode(f)}`,
            taskNo: no,
            facility: f,
            status: "open",
            bad: 0,
            lines: byFacility[f],
          }),
        );

        const task: PickingTask = {
          no,
          channel,
          demand: JSON.parse(JSON.stringify(demand)),
          facilities,
          shortfall,
          createdAt: new Date().toISOString(),
        };
        set({
          tasks: [...tasks, task],
          taskSeq: seq,
          demand: [],
          notice: `${no} created — ${facilities.length} facility picklist(s), stock soft-blocked.`,
        });
      },

      markFacilityCompleted: (taskNo, facilityNo, nf) => {
        const state = get();
        const stock = state.stock.map((b) => ({ ...b }));
        let gpSeq = state.gpSeq;
        const tasks = state.tasks.map((t) => {
          if (t.no !== taskNo) return t;
          const facilities = t.facilities.map((f) => {
            if (f.no !== facilityNo || f.status !== "open") return f;
            let picked = 0;
            let bad = 0;
            const lines = f.lines.map((l) => {
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
              ...f,
              lines,
              bad,
              pickedTotal: picked,
              status: "completed" as const,
              gp: "GP-" + String(100000 + gpSeq * 137).slice(0, 6),
            };
          });
          return { ...t, facilities };
        });
        set({ tasks, stock, gpSeq, notice: `${facilityNo} completed.` });
      },
    }),
    { name: "fefo-smart-picking-v2" },
  ),
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CHANNELS } from "./channels";
import { allocate, cutoffMonths } from "./engine";
import { FACILITY_PRIORITY, facilityCode } from "./facilities";
import { rowsFromTuples, type StockTuple } from "./sampleData";
import { REAL_STOCK } from "./stockSnapshot";
import type {
  ChannelRule,
  DemandLine,
  FacilityPicklist,
  PickingTask,
  PickLine,
  Role,
  Shortfall,
  SkuInfo,
  StockRow,
} from "./types";

export const PICKERS_DEFAULT = ["Ravi", "Sunil", "Amit"];

export function allFacilityLists(tasks: PickingTask[]): FacilityPicklist[] {
  return tasks.flatMap((t) => t.facilities);
}

/** A line still reserves stock until it has actually been picked. */
export function reservedFor(tasks: PickingTask[], rid: number): number {
  let r = 0;
  for (const f of allFacilityLists(tasks)) {
    for (const l of f.lines) if (l.rid === rid && l.picked == null) r += l.qty;
  }
  return r;
}

export function facilityDone(f: FacilityPicklist): boolean {
  return f.lines.every((l) => l.picked != null);
}

export function taskIsComplete(t: PickingTask): boolean {
  return t.facilities.length > 0 && t.facilities.every(facilityDone);
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

/** Fill one SKU's need across facilities in priority order (FEFO + tolerance). */
function waterfall(
  sku: string,
  need: number,
  cutoff: number,
  stock: StockRow[],
  priority: string[],
  reserved: (rid: number) => number,
  exclude: number[],
): { byFacility: Record<string, PickLine[]>; short: number } {
  const byFacility: Record<string, PickLine[]> = {};
  let remain = need;
  for (const facility of priority) {
    if (remain <= 0) break;
    const r = allocate({ sku, need: remain, location: facility, cutoff, stock, reservedFor: reserved, exclude });
    if (r.lines.length) {
      (byFacility[facility] ??= []).push(...r.lines);
      remain = r.short;
    }
  }
  return { byFacility, short: remain };
}

function buildFacilityLists(
  taskNo: string,
  round: number,
  byFacility: Record<string, PickLine[]>,
  priority: string[],
  suffix = "",
): FacilityPicklist[] {
  return priority
    .filter((f) => byFacility[f]?.length)
    .map((f) => ({
      no: `${taskNo}-${facilityCode(f)}${suffix}`,
      taskNo,
      facility: f,
      status: "open" as const,
      round,
      bad: 0,
      lines: byFacility[f],
    }));
}

export interface AppState {
  stock: StockRow[];
  skus: Record<string, SkuInfo>;
  channelRules: Record<string, ChannelRule>;
  facilityPriority: string[];
  fetchTime: string;
  pickers: string[];
  lastSync: string;

  visibleFacilities: string[];
  channel: string;
  role: Role;
  currentPicker: string;
  demand: DemandLine[];
  tasks: PickingTask[];
  taskSeq: number;
  gpSeq: number;
  notice: string;

  locations: () => string[];
  anyOpen: () => boolean;
  setRole: (r: Role) => void;
  setCurrentPicker: (p: string) => void;
  toggleFacility: (f: string) => void;
  syncStock: () => void;
  loadStock: (tuples: StockTuple[]) => void;
  setChannel: (c: string) => void;
  setDemand: (d: DemandLine[]) => void;
  removeDemand: (i: number) => void;
  generate: () => void;
  assignAll: (facilityNo: string, picker: string) => void;
  assignLine: (rid: number, facilityNo: string, picker: string) => void;
  uploadAssignments: (facilityNo: string, text: string) => void;
  applyPicks: (facilityNo: string, results: Record<number, number>) => void;
  updateChannelRule: (channel: string, rule: ChannelRule) => void;
  setFacilityPriority: (p: string[]) => void;
  setFetchTime: (t: string) => void;
}

const initialStock = rowsFromTuples(REAL_STOCK);

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      stock: initialStock,
      skus: skusFromStock(initialStock),
      channelRules: { ...CHANNELS },
      facilityPriority: [...FACILITY_PRIORITY],
      fetchTime: "07:30",
      pickers: [...PICKERS_DEFAULT],
      lastSync: new Date().toISOString(),

      visibleFacilities: [...FACILITY_PRIORITY],
      channel: "Blinkit",
      role: "supervisor",
      currentPicker: PICKERS_DEFAULT[0],
      demand: [],
      tasks: [],
      taskSeq: 0,
      gpSeq: 0,
      notice: "",

      locations: () => [...new Set(get().stock.map((b) => b.location))],
      anyOpen: () => allFacilityLists(get().tasks).some((f) => f.lines.some((l) => l.picked == null)),
      setRole: (r) => set({ role: r }),
      setCurrentPicker: (p) => set({ currentPicker: p }),
      toggleFacility: (f) =>
        set({
          visibleFacilities: get().visibleFacilities.includes(f)
            ? get().visibleFacilities.filter((x) => x !== f)
            : [...get().visibleFacilities, f],
        }),

      // Pull the latest stock from the auto-generated email (simulated in Phase A).
      syncStock: () => {
        if (get().anyOpen()) return set({ notice: "Feed frozen — complete open picking before syncing." });
        const stock = rowsFromTuples(REAL_STOCK);
        set({ stock, skus: skusFromStock(stock), lastSync: new Date().toISOString(), notice: "Stock synced from email." });
      },

      loadStock: (tuples) => {
        const stock = rowsFromTuples(tuples);
        set({ stock, skus: skusFromStock(stock), lastSync: new Date().toISOString() });
      },

      setChannel: (c) => set({ channel: c }),
      setDemand: (d) => set({ demand: d }),
      removeDemand: (i) => set({ demand: get().demand.filter((_, idx) => idx !== i) }),

      generate: () => {
        const { skus, demand, channel, channelRules, facilityPriority, stock, tasks, taskSeq } = get();
        if (Object.keys(skus).length === 0) return set({ notice: "No stock synced yet." });
        if (demand.length === 0) return set({ notice: "Add demand first." });
        const rule = channelRules[channel];
        if (!rule) return set({ notice: "Unknown channel." });

        const seq = taskSeq + 1;
        const no = taskNumber(seq);
        const reserved = (rid: number) => reservedFor(tasks, rid);
        const byFacility: Record<string, PickLine[]> = {};
        const shortfall: Shortfall[] = [];

        for (const d of demand) {
          const cutoff = cutoffMonths(rule, skus[d.sku].shelf);
          const w = waterfall(d.sku, d.qty, cutoff, stock, facilityPriority, reserved, []);
          for (const f of Object.keys(w.byFacility)) (byFacility[f] ??= []).push(...w.byFacility[f]);
          if (w.short > 0) shortfall.push({ sku: d.sku, name: skus[d.sku].name, qty: w.short });
        }

        const task: PickingTask = {
          no,
          channel,
          demand: JSON.parse(JSON.stringify(demand)),
          facilities: buildFacilityLists(no, 1, byFacility, facilityPriority),
          shortfall,
          createdAt: new Date().toISOString(),
        };
        set({ tasks: [...tasks, task], taskSeq: seq, demand: [], notice: `${no} created — ${task.facilities.length} facility picklist(s).` });
      },

      assignAll: (facilityNo, picker) =>
        set({
          tasks: get().tasks.map((t) => ({
            ...t,
            facilities: t.facilities.map((f) => (f.no === facilityNo ? { ...f, lines: f.lines.map((l) => ({ ...l, picker })) } : f)),
          })),
        }),

      assignLine: (rid, facilityNo, picker) =>
        set({
          tasks: get().tasks.map((t) => ({
            ...t,
            facilities: t.facilities.map((f) =>
              f.no === facilityNo ? { ...f, lines: f.lines.map((l) => (l.rid === rid ? { ...l, picker } : l)) } : f,
            ),
          })),
        }),

      uploadAssignments: (facilityNo, text) => {
        const map: Record<string, string> = {};
        text.trim().split(/\r?\n/).forEach((ln) => {
          const c = ln.split(",").map((s) => s.trim());
          if (/location/i.test(ln) && /picker/i.test(ln)) return;
          const bin = c.find((x) => /[A-Za-z]+-?[A-Za-z]\d+/.test(x));
          const picker = c[c.length - 1];
          if (bin && picker) map[bin] = picker;
        });
        set({
          tasks: get().tasks.map((t) => ({
            ...t,
            facilities: t.facilities.map((f) =>
              f.no === facilityNo ? { ...f, lines: f.lines.map((l) => (map[l.bin] ? { ...l, picker: map[l.bin] } : l)) } : f,
            ),
          })),
          notice: "Assignments uploaded.",
        });
      },

      applyPicks: (facilityNo, results) => {
        const state = get();
        const stock = state.stock.map((b) => ({ ...b }));
        let gpSeq = state.gpSeq;

        let tasks = state.tasks.map((t) => ({
          ...t,
          facilities: t.facilities.map((f) => {
            if (f.no !== facilityNo) return f;
            const lines = f.lines.map((l) => {
              if (l.picked != null || !(l.rid in results)) return l;
              let n = results[l.rid];
              if (isNaN(n) || n < 0) n = 0;
              if (n > l.qty) n = l.qty;
              const pk = l.qty - n;
              const b = stock.find((x) => x.rid === l.rid);
              if (b) b.qty = Math.max(0, b.qty - pk);
              return { ...l, nf: n, picked: pk };
            });
            return { ...f, lines };
          }),
        }));

        let completedFacility: FacilityPicklist | undefined;
        let parentTask: PickingTask | undefined;
        tasks = tasks.map((t) => {
          const facilities = t.facilities.map((f) => {
            if (f.no !== facilityNo || f.status === "completed" || !facilityDone(f)) return f;
            const picked = f.lines.reduce((s, l) => s + (l.picked ?? 0), 0);
            const bad = f.lines.reduce((s, l) => s + (l.nf ?? 0), 0);
            gpSeq += 1;
            const finished: FacilityPicklist = { ...f, status: "completed", pickedTotal: picked, bad, gp: "GP-" + String(100000 + gpSeq * 137).slice(0, 6) };
            completedFacility = finished;
            parentTask = t;
            return finished;
          });
          return { ...t, facilities };
        });

        if (completedFacility && parentTask && completedFacility.bad > 0) {
          const task = parentTask;
          const rule = state.channelRules[task.channel];
          const usedRids = new Set(task.facilities.flatMap((f) => f.lines.map((l) => l.rid)));
          const nfBySku: Record<string, number> = {};
          completedFacility.lines.forEach((l) => { if (l.nf) nfBySku[l.sku] = (nfBySku[l.sku] ?? 0) + l.nf; });
          const r2: Record<string, PickLine[]> = {};
          const extraShort: Shortfall[] = [];
          const reserved = (rid: number) => reservedFor(tasks, rid);
          for (const sku of Object.keys(nfBySku)) {
            const cutoff = cutoffMonths(rule, state.skus[sku].shelf);
            const w = waterfall(sku, nfBySku[sku], cutoff, stock, state.facilityPriority, reserved, [...usedRids]);
            for (const f of Object.keys(w.byFacility)) {
              (r2[f] ??= []).push(...w.byFacility[f]);
              w.byFacility[f].forEach((l) => usedRids.add(l.rid));
            }
            if (w.short > 0) extraShort.push({ sku, name: state.skus[sku].name, qty: w.short });
          }
          const r2Lists = buildFacilityLists(task.no, 2, r2, state.facilityPriority, "-R2");
          if (r2Lists.length || extraShort.length) {
            tasks = tasks.map((t) => (t.no === task.no ? { ...t, facilities: [...t.facilities, ...r2Lists], shortfall: [...t.shortfall, ...extraShort] } : t));
          }
        }

        set({ tasks, stock, gpSeq, notice: `${facilityNo} updated.` });
      },

      updateChannelRule: (channel, rule) => set({ channelRules: { ...get().channelRules, [channel]: rule } }),
      setFacilityPriority: (p) => set({ facilityPriority: p }),
      setFetchTime: (t) => set({ fetchTime: t }),
    }),
    {
      name: "fefo-smart-picking-v5",
      // Stock is not persisted — it always comes fresh from the feed (snapshot / email).
      partialize: (s) => ({
        tasks: s.tasks,
        taskSeq: s.taskSeq,
        gpSeq: s.gpSeq,
        channelRules: s.channelRules,
        facilityPriority: s.facilityPriority,
        fetchTime: s.fetchTime,
        pickers: s.pickers,
        visibleFacilities: s.visibleFacilities,
        channel: s.channel,
        role: s.role,
        currentPicker: s.currentPicker,
      }),
    },
  ),
);

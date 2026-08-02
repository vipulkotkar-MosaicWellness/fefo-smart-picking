import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bucketCode, channelCode, CHANNELS } from "./channels";
import { allocate, cutoffMonths } from "./engine";
import { FACILITY_PRIORITY, facilityCode } from "./facilities";
import { PICKERS_DEFAULT, usePickers } from "./pickersStore";
import { rowsFromTuples, type StockTuple } from "./sampleData";
import { REAL_STOCK } from "./stockSnapshot";
import { isSupabaseConfigured } from "./supabaseClient";
import { fetchLastSync, fetchStock } from "./supabaseStock";
import { fetchAllTasks, insertTask, nextSequence, subscribeTasks, updateTaskData } from "./tasksSupabase";
import type {
  ChannelRule,
  DemandLine,
  FacilityPicklist,
  PickingTask,
  PickLine,
  Shortfall,
  SkuInfo,
  StockRow,
} from "./types";

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

/** Picklist number = Channel Bucket + Channel + Date + Sequence, e.g. B2BE-AMAZON-260729-001. */
function todayYmd(): string {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function taskNumberPrefix(channel: string): string {
  return `${bucketCode(channel)}-${channelCode(channel)}-${todayYmd()}-`;
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

/** Merge a task update in: replaces the task if its `no` matches, else appends. */
function mergeTask(tasks: PickingTask[], updated: PickingTask): PickingTask[] {
  const i = tasks.findIndex((t) => t.no === updated.no);
  if (i < 0) return [...tasks, updated];
  const next = tasks.slice();
  next[i] = updated;
  return next;
}

export interface AppState {
  stock: StockRow[];
  skus: Record<string, SkuInfo>;
  channelRules: Record<string, ChannelRule>;
  facilityPriority: string[];
  pickers: string[];
  lastSync: string;
  syncing: boolean;

  visibleFacilities: string[];
  skuFilter: string;
  demand: DemandLine[];
  tasks: PickingTask[];
  tasksLoaded: boolean;
  gpSeq: number;
  notice: string;

  locations: () => string[];
  anyOpen: () => boolean;
  toggleFacility: (f: string) => void;
  setSkuFilter: (s: string) => void;
  syncStock: () => void;
  loadFromSupabase: () => Promise<void>;
  loadStock: (tuples: StockTuple[]) => void;
  loadTasks: () => Promise<void>;
  startTasksRealtime: () => () => void;
  loadPickers: () => Promise<void>;
  setDemand: (d: DemandLine[]) => void;
  removeDemand: (i: number) => void;
  generate: (createdBy: string | null) => Promise<void>;
  assignAll: (facilityNo: string, picker: string) => Promise<void>;
  assignLine: (rid: number, facilityNo: string, picker: string) => Promise<void>;
  uploadAssignments: (facilityNo: string, text: string) => Promise<void>;
  applyPicks: (facilityNo: string, results: Record<number, number>) => Promise<void>;
  updateChannelRule: (channel: string, rule: ChannelRule) => void;
  setFacilityPriority: (p: string[]) => void;
}

const initialStock = rowsFromTuples(REAL_STOCK);

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      stock: initialStock,
      skus: skusFromStock(initialStock),
      channelRules: { ...CHANNELS },
      facilityPriority: [...FACILITY_PRIORITY],
      pickers: [...PICKERS_DEFAULT],
      lastSync: new Date().toISOString(),
      syncing: false,

      visibleFacilities: [...FACILITY_PRIORITY],
      skuFilter: "",
      demand: [],
      tasks: [],
      tasksLoaded: false,
      gpSeq: 0,
      notice: "",

      locations: () => [...new Set(get().stock.map((b) => b.location))],
      anyOpen: () => allFacilityLists(get().tasks).some((f) => f.lines.some((l) => l.picked == null)),
      setSkuFilter: (s) => set({ skuFilter: s }),
      toggleFacility: (f) =>
        set({
          visibleFacilities: get().visibleFacilities.includes(f)
            ? get().visibleFacilities.filter((x) => x !== f)
            : [...get().visibleFacilities, f],
        }),

      loadPickers: async () => {
        if (!isSupabaseConfigured) return;
        await usePickers.getState().load();
        const live = usePickers.getState().pickers;
        set({ pickers: live.length ? live : [...PICKERS_DEFAULT] });
      },

      loadTasks: async () => {
        if (!isSupabaseConfigured) {
          set({ tasksLoaded: true });
          return;
        }
        try {
          const tasks = await fetchAllTasks();
          set({ tasks, tasksLoaded: true });
        } catch (e) {
          set({ notice: "Could not load picklists: " + (e as Error).message, tasksLoaded: true });
        }
      },

      startTasksRealtime: () => {
        if (!isSupabaseConfigured) return () => {};
        return subscribeTasks((task) => set({ tasks: mergeTask(get().tasks, task) }));
      },

      // Pull the latest stock. Live from Supabase when configured, else the snapshot.
      syncStock: () => {
        if (get().anyOpen()) return set({ notice: "⚠ Feed frozen — complete open picking before syncing." });
        if (isSupabaseConfigured) {
          void get().loadFromSupabase();
          return;
        }
        const stock = rowsFromTuples(REAL_STOCK);
        set({ stock, skus: skusFromStock(stock), lastSync: new Date().toISOString(), notice: "✓ Stock reloaded from snapshot." });
      },

      loadFromSupabase: async () => {
        if (!isSupabaseConfigured) return;
        const prevLast = get().lastSync;
        set({ syncing: true, notice: "Checking for new stock…" });
        try {
          const rows = await fetchStock();
          const last = await fetchLastSync();
          const changed = last && last !== prevLast;
          set({
            stock: rows,
            skus: skusFromStock(rows),
            lastSync: last ?? new Date().toISOString(),
            syncing: false,
            notice: changed
              ? `✓ New stock loaded — ${rows.length.toLocaleString()} rows.`
              : `✓ Up to date — ${rows.length.toLocaleString()} rows (next email refresh is hourly).`,
          });
        } catch (e) {
          set({ syncing: false, notice: "✗ Sync failed: " + (e as Error).message });
        }
      },

      loadStock: (tuples) => {
        const stock = rowsFromTuples(tuples);
        set({ stock, skus: skusFromStock(stock), lastSync: new Date().toISOString() });
      },

      setDemand: (d) => set({ demand: d }),
      removeDemand: (i) => set({ demand: get().demand.filter((_, idx) => idx !== i) }),

      // One picking task per channel present in the demand list, created together
      // so a single multi-channel CSV upload queues multiple picklists at once.
      generate: async (createdBy) => {
        const { skus, demand, channelRules, facilityPriority, stock, tasks } = get();
        if (Object.keys(skus).length === 0) {
          set({ notice: "No stock synced yet." });
          return;
        }
        if (demand.length === 0) {
          set({ notice: "Add demand first." });
          return;
        }

        const byChannel = new Map<string, DemandLine[]>();
        for (const d of demand) {
          if (!byChannel.has(d.channel)) byChannel.set(d.channel, []);
          byChannel.get(d.channel)!.push(d);
        }

        const reserved = (rid: number) => reservedFor(tasks, rid);
        const newTasks: PickingTask[] = [];

        for (const [channel, lines] of byChannel) {
          const rule = channelRules[channel];
          if (!rule) continue;
          const prefix = taskNumberPrefix(channel);
          const seq = isSupabaseConfigured ? await nextSequence(prefix) : newTasks.length + 1;
          const no = `${prefix}${String(seq).padStart(3, "0")}`;
          const byFacility: Record<string, PickLine[]> = {};
          const shortfall: Shortfall[] = [];
          for (const d of lines) {
            const cutoff = cutoffMonths(rule, skus[d.sku].shelf);
            const w = waterfall(d.sku, d.qty, cutoff, stock, facilityPriority, reserved, []);
            for (const f of Object.keys(w.byFacility)) (byFacility[f] ??= []).push(...w.byFacility[f]);
            if (w.short > 0) shortfall.push({ sku: d.sku, name: skus[d.sku].name, qty: w.short });
          }
          newTasks.push({
            no,
            channel,
            demand: JSON.parse(JSON.stringify(lines)),
            facilities: buildFacilityLists(no, 1, byFacility, facilityPriority),
            shortfall,
            createdAt: new Date().toISOString(),
          });
        }

        set({
          tasks: [...tasks, ...newTasks],
          demand: [],
          notice: `${newTasks.length} picking task(s) created — ${newTasks.map((t) => t.no).join(", ")}.`,
        });

        if (isSupabaseConfigured) {
          for (const t of newTasks) {
            try {
              await insertTask(t, createdBy);
            } catch (e) {
              set({ notice: "Could not save " + t.no + ": " + (e as Error).message });
            }
          }
        }
      },

      assignAll: async (facilityNo, picker) => {
        let changed: PickingTask | undefined;
        const tasks = get().tasks.map((t) => {
          if (!t.facilities.some((f) => f.no === facilityNo)) return t;
          const next = { ...t, facilities: t.facilities.map((f) => (f.no === facilityNo ? { ...f, lines: f.lines.map((l) => ({ ...l, picker })) } : f)) };
          changed = next;
          return next;
        });
        set({ tasks });
        if (isSupabaseConfigured && changed) await updateTaskData(changed);
      },

      assignLine: async (rid, facilityNo, picker) => {
        let changed: PickingTask | undefined;
        const tasks = get().tasks.map((t) => {
          if (!t.facilities.some((f) => f.no === facilityNo)) return t;
          const next = {
            ...t,
            facilities: t.facilities.map((f) =>
              f.no === facilityNo ? { ...f, lines: f.lines.map((l) => (l.rid === rid ? { ...l, picker } : l)) } : f,
            ),
          };
          changed = next;
          return next;
        });
        set({ tasks });
        if (isSupabaseConfigured && changed) await updateTaskData(changed);
      },

      uploadAssignments: async (facilityNo, text) => {
        const map: Record<string, string> = {};
        text.trim().split(/\r?\n/).forEach((ln) => {
          const c = ln.split(",").map((s) => s.trim());
          if (/location/i.test(ln) && /picker/i.test(ln)) return;
          const bin = c.find((x) => /[A-Za-z]+-?[A-Za-z]\d+/.test(x));
          const picker = c[c.length - 1];
          if (bin && picker) map[bin] = picker;
        });
        let changed: PickingTask | undefined;
        const tasks = get().tasks.map((t) => {
          if (!t.facilities.some((f) => f.no === facilityNo)) return t;
          const next = {
            ...t,
            facilities: t.facilities.map((f) =>
              f.no === facilityNo ? { ...f, lines: f.lines.map((l) => (map[l.bin] ? { ...l, picker: map[l.bin] } : l)) } : f,
            ),
          };
          changed = next;
          return next;
        });
        set({ tasks, notice: "Assignments uploaded." });
        if (isSupabaseConfigured && changed) await updateTaskData(changed);
      },

      applyPicks: async (facilityNo, results) => {
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

        const finalTask = tasks.find((t) => t.no === (parentTask?.no ?? ""));
        if (isSupabaseConfigured && finalTask) await updateTaskData(finalTask);
      },

      updateChannelRule: (channel, rule) => set({ channelRules: { ...get().channelRules, [channel]: rule } }),
      setFacilityPriority: (p) => set({ facilityPriority: p }),
    }),
    {
      name: "fefo-smart-picking-v7",
      // Stock and tasks are not persisted locally when Supabase is configured —
      // they come live from the shared database instead. Local mode (no
      // Supabase keys) keeps everything in browser storage as before.
      partialize: (s) => ({
        tasks: isSupabaseConfigured ? [] : s.tasks,
        gpSeq: s.gpSeq,
        channelRules: s.channelRules,
        facilityPriority: s.facilityPriority,
        pickers: s.pickers,
        visibleFacilities: s.visibleFacilities,
      }),
    },
  ),
);

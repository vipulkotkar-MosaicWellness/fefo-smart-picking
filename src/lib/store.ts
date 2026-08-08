import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bucketCode, channelCode, CHANNELS, type ChannelBucket } from "./channels";
import { allocate, cutoffMonths } from "./engine";
import { FACILITY_PRIORITY, facilityCode } from "./facilities";
import { matchesCutoff } from "./dateRanges";
import { dequeue as dequeuePick, enqueue as enqueuePick, loadQueue as loadPickQueue } from "./offlineQueue";
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

/**
 * Every task except ones that have been archived — the default view for
 * every operational screen, report, and the FEFO reservation engine.
 * Archiving hides a picklist and frees the stock it was holding without
 * deleting the underlying record (still reachable, read-only, under
 * Archived picklists).
 */
export function activeTasks(tasks: PickingTask[]): PickingTask[] {
  return tasks.filter((t) => !t.archived);
}

/** A line still reserves stock until it has actually been picked. Archived tasks never reserve. */
export function reservedFor(tasks: PickingTask[], rid: number): number {
  let r = 0;
  for (const f of allFacilityLists(activeTasks(tasks))) {
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
function taskNumberPrefix(channel: string, customBuckets: Record<string, ChannelBucket>): string {
  return `${bucketCode(channel, customBuckets)}-${channelCode(channel)}-${todayYmd()}-`;
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

/**
 * Resolve one pick line's outcome from what the picker entered — unchanged
 * if it's not in this batch of results or was already picked. Pure, so the
 * not-found quantity + reason logic can be tested without touching
 * applyPicks' Supabase write.
 */
export function resolvePickLine(line: PickLine, results: Record<number, number>, reasons?: Record<number, string>): PickLine {
  if (line.picked != null || !(line.rid in results)) return line;
  let n = results[line.rid];
  if (isNaN(n) || n < 0) n = 0;
  if (n > line.qty) n = line.qty;
  const picked = line.qty - n;
  return { ...line, nf: n, nfReason: n > 0 ? reasons?.[line.rid] : undefined, picked };
}

export interface ChannelAllocation {
  channel: string;
  gatePassNo: string;
  byFacility: Record<string, PickLine[]>;
  shortfall: Shortfall[];
}

function gatePassGroupKey(d: DemandLine): string {
  return `${d.channel}::${d.gatePassNo}`;
}

/**
 * Pure FEFO waterfall allocation for a demand list, grouped by (channel,
 * gate pass) — a gate pass is one dispatch document and may carry several
 * SKUs, so every SKU under the same gate pass number becomes one picklist.
 * No Supabase, no store mutation, no numbering. `generate()` uses this to
 * build real tasks; the Demand Planner's "review allocation" step calls the
 * same function to preview, so preview and generate can never disagree.
 */
export function computeChannelAllocations(
  demand: DemandLine[],
  channelRules: Record<string, ChannelRule>,
  skus: Record<string, SkuInfo>,
  stock: StockRow[],
  facilityPriority: string[],
  existingTasks: PickingTask[],
): ChannelAllocation[] {
  const byGroup = new Map<string, DemandLine[]>();
  for (const d of demand) {
    const key = gatePassGroupKey(d);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(d);
  }

  const reserved = (rid: number) => reservedFor(existingTasks, rid);
  const out: ChannelAllocation[] = [];
  for (const lines of byGroup.values()) {
    const channel = lines[0].channel;
    const gatePassNo = lines[0].gatePassNo;
    const rule = channelRules[channel];
    if (!rule) continue;
    const byFacility: Record<string, PickLine[]> = {};
    const shortfall: Shortfall[] = [];
    for (const d of lines) {
      const cutoff = cutoffMonths(rule, skus[d.sku].shelf);
      const w = waterfall(d.sku, d.qty, cutoff, stock, facilityPriority, reserved, []);
      for (const f of Object.keys(w.byFacility)) (byFacility[f] ??= []).push(...w.byFacility[f]);
      if (w.short > 0) shortfall.push({ sku: d.sku, name: skus[d.sku].name, qty: w.short });
    }
    out.push({ channel, gatePassNo, byFacility, shortfall });
  }
  return out;
}

function buildFacilityLists(
  taskNo: string,
  round: number,
  byFacility: Record<string, PickLine[]>,
  priority: string[],
  suffix = "",
): FacilityPicklist[] {
  const createdAt = new Date().toISOString();
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
      createdAt,
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

export interface SavedInventoryView {
  name: string;
  filters: { text?: string; batch?: string; location?: string; minQty?: number; maxQty?: number };
  sort: "expiry" | "facility";
}

export interface PartnerLogoState {
  dataUrl: string;
  approved: boolean;
}

export interface AuditEntry {
  at: string;
  by: string;
  action: string;
}

export interface AppState {
  stock: StockRow[];
  skus: Record<string, SkuInfo>;
  channelRules: Record<string, ChannelRule>;
  channelBuckets: Record<string, ChannelBucket>; // Admin-added channels only — built-in ones live in CHANNEL_BUCKETS
  facilityPriority: string[];
  pickers: string[];
  lastSync: string;
  syncing: boolean;

  visibleFacilities: string[];
  demand: DemandLine[];
  tasks: PickingTask[];
  tasksLoaded: boolean;
  gpSeq: number;
  notice: string;

  savedInventoryViews: SavedInventoryView[];
  partnerActive: Record<string, boolean>;
  partnerLogos: Record<string, PartnerLogoState>;
  auditLog: AuditEntry[];

  saveInventoryView: (v: SavedInventoryView) => void;
  deleteInventoryView: (name: string) => void;
  setPartnerActive: (channel: string, active: boolean) => void;
  setPartnerLogo: (channel: string, dataUrl: string) => void;
  approvePartnerLogo: (channel: string, approved: boolean) => void;
  logAudit: (by: string, action: string) => void;

  locations: () => string[];
  anyOpen: () => boolean;
  toggleFacility: (f: string) => void;
  syncStock: () => void;
  loadFromSupabase: () => Promise<void>;
  loadStock: (tuples: StockTuple[]) => void;
  loadTasks: () => Promise<void>;
  startTasksRealtime: () => () => void;
  loadPickers: () => Promise<void>;
  setDemand: (d: DemandLine[]) => void;
  removeDemand: (i: number) => void;
  generate: (createdBy: string | null, createdByName: string | null) => Promise<void>;
  assignAll: (facilityNo: string, picker: string) => Promise<void>;
  assignLine: (rid: number, facilityNo: string, picker: string) => Promise<void>;
  uploadAssignments: (facilityNo: string, text: string) => Promise<void>;
  applyPicks: (facilityNo: string, results: Record<number, number>, reasons?: Record<number, string>) => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
  updateChannelRule: (channel: string, rule: ChannelRule) => void;
  addChannel: (name: string, bucket: ChannelBucket, rule: ChannelRule) => void;
  setFacilityPriority: (p: string[]) => void;
  archiveTask: (taskNo: string) => Promise<void>;
  unarchiveTask: (taskNo: string) => Promise<void>;
  archiveAllActiveTasks: () => Promise<void>;
  archiveByCutoff: (cutoffDate: string, direction: "before" | "after") => Promise<number>;
}

const initialStock = rowsFromTuples(REAL_STOCK);

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      stock: initialStock,
      skus: skusFromStock(initialStock),
      channelRules: { ...CHANNELS },
      channelBuckets: {},
      facilityPriority: [...FACILITY_PRIORITY],
      pickers: [...PICKERS_DEFAULT],
      lastSync: new Date().toISOString(),
      syncing: false,

      visibleFacilities: [...FACILITY_PRIORITY],
      demand: [],
      tasks: [],
      tasksLoaded: false,
      gpSeq: 0,
      notice: "",

      savedInventoryViews: [],
      partnerActive: {},
      partnerLogos: {},
      auditLog: [],

      saveInventoryView: (v) =>
        set({ savedInventoryViews: [...get().savedInventoryViews.filter((x) => x.name !== v.name), v] }),
      deleteInventoryView: (name) => set({ savedInventoryViews: get().savedInventoryViews.filter((v) => v.name !== name) }),
      setPartnerActive: (channel, active) => set({ partnerActive: { ...get().partnerActive, [channel]: active } }),
      setPartnerLogo: (channel, dataUrl) =>
        set({ partnerLogos: { ...get().partnerLogos, [channel]: { dataUrl, approved: false } } }),
      approvePartnerLogo: (channel, approved) => {
        const existing = get().partnerLogos[channel];
        if (!existing) return;
        set({ partnerLogos: { ...get().partnerLogos, [channel]: { ...existing, approved } } });
      },
      logAudit: (by, action) =>
        set({ auditLog: [{ at: new Date().toISOString(), by, action }, ...get().auditLog].slice(0, 200) }),

      locations: () => [...new Set(get().stock.map((b) => b.location))],
      anyOpen: () => allFacilityLists(activeTasks(get().tasks)).some((f) => f.lines.some((l) => l.picked == null)),
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

      // One picking task per (channel, gate pass) present in the demand list,
      // created together so a single multi-channel CSV upload queues
      // multiple picklists at once. Internal task numbers keep working as
      // before (needed for FEFO reservation + Alternate Picklist linking);
      // gatePassNo is the customer-facing label captured at upload time.
      generate: async (createdBy, createdByName) => {
        const { skus, demand, channelRules, facilityPriority, stock, tasks } = get();
        if (Object.keys(skus).length === 0) {
          set({ notice: "No stock synced yet." });
          return;
        }
        if (demand.length === 0) {
          set({ notice: "Add demand first." });
          return;
        }

        const allocations = computeChannelAllocations(demand, channelRules, skus, stock, facilityPriority, activeTasks(tasks));
        const demandByGroup = new Map<string, DemandLine[]>();
        for (const d of demand) {
          const key = `${d.channel}::${d.gatePassNo}`;
          if (!demandByGroup.has(key)) demandByGroup.set(key, []);
          demandByGroup.get(key)!.push(d);
        }
        const newTasks: PickingTask[] = [];

        for (const { channel, gatePassNo, byFacility, shortfall } of allocations) {
          const prefix = taskNumberPrefix(channel, get().channelBuckets);
          const seq = isSupabaseConfigured ? await nextSequence(prefix) : newTasks.length + 1;
          const no = `${prefix}${String(seq).padStart(3, "0")}`;
          newTasks.push({
            no,
            gatePassNo,
            channel,
            demand: JSON.parse(JSON.stringify(demandByGroup.get(`${channel}::${gatePassNo}`))),
            facilities: buildFacilityLists(no, 1, byFacility, facilityPriority),
            shortfall,
            createdAt: new Date().toISOString(),
            createdByName: createdByName ?? undefined,
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

      applyPicks: async (facilityNo, results, reasons) => {
        const state = get();
        const stock = state.stock.map((b) => ({ ...b }));
        let gpSeq = state.gpSeq;

        let tasks = state.tasks.map((t) => ({
          ...t,
          facilities: t.facilities.map((f) => {
            if (f.no !== facilityNo) return f;
            const lines = f.lines.map((l) => {
              const resolved = resolvePickLine(l, results, reasons);
              if (resolved === l) return l;
              const b = stock.find((x) => x.rid === l.rid);
              if (b) b.qty = Math.max(0, b.qty - resolved.picked!);
              return resolved;
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
        if (isSupabaseConfigured && finalTask) {
          try {
            await updateTaskData(finalTask);
          } catch {
            // Offline or a transient failure — the pick is already applied
            // locally above; queue the sync so it isn't silently lost.
            enqueuePick({ facilityNo, results });
            set({ notice: "⚠ Saved on this device — will sync once you're back online." });
          }
        }
      },

      flushOfflineQueue: async () => {
        if (!isSupabaseConfigured) return;
        const queue = loadPickQueue();
        if (queue.length === 0) return;
        const { tasks } = get();
        for (const item of queue) {
          const task = tasks.find((t) => t.facilities.some((f) => f.no === item.facilityNo));
          if (!task) {
            dequeuePick(item.id);
            continue;
          }
          try {
            await updateTaskData(task);
            dequeuePick(item.id);
          } catch {
            // Still offline / still failing — leave it queued for next time.
          }
        }
        if (loadPickQueue().length === 0) set({ notice: "✓ Synced queued pick(s)." });
      },

      updateChannelRule: (channel, rule) => set({ channelRules: { ...get().channelRules, [channel]: rule } }),
      addChannel: (name, bucket, rule) =>
        set({
          channelRules: { ...get().channelRules, [name]: rule },
          channelBuckets: { ...get().channelBuckets, [name]: bucket },
        }),
      setFacilityPriority: (p) => set({ facilityPriority: p }),

      archiveTask: async (taskNo) => {
        const updated = get().tasks.find((t) => t.no === taskNo);
        if (!updated) return;
        const archived = { ...updated, archived: true };
        set({ tasks: mergeTask(get().tasks, archived) });
        if (isSupabaseConfigured) await updateTaskData(archived);
      },

      unarchiveTask: async (taskNo) => {
        const existing = get().tasks.find((t) => t.no === taskNo);
        if (!existing) return;
        const restored = { ...existing, archived: false };
        set({ tasks: mergeTask(get().tasks, restored) });
        if (isSupabaseConfigured) await updateTaskData(restored);
      },

      // The non-destructive "start fresh" action: every currently-active
      // picklist moves to Archived (out of every operational view/report and
      // out of FEFO reservation) without deleting anything. Reversible via
      // unarchiveTask, unlike a database delete.
      archiveAllActiveTasks: async () => {
        const toArchive = activeTasks(get().tasks);
        if (toArchive.length === 0) return;
        const archivedTasks = toArchive.map((t) => ({ ...t, archived: true }));
        let tasks = get().tasks;
        for (const t of archivedTasks) tasks = mergeTask(tasks, t);
        set({ tasks, notice: `${archivedTasks.length} picklist(s) archived.` });
        if (isSupabaseConfigured) {
          for (const t of archivedTasks) {
            try {
              await updateTaskData(t);
            } catch (e) {
              set({ notice: "Could not archive " + t.no + ": " + (e as Error).message });
            }
          }
        }
      },

      // Archive by a chosen cutoff date instead of all-or-nothing — e.g.
      // "everything before 7 Aug" or "everything from 7 Aug onward".
      archiveByCutoff: async (cutoffDate, direction) => {
        const toArchive = activeTasks(get().tasks).filter((t) => matchesCutoff(t.createdAt, cutoffDate, direction));
        if (toArchive.length === 0) return 0;
        const archivedTasks = toArchive.map((t) => ({ ...t, archived: true }));
        let tasks = get().tasks;
        for (const t of archivedTasks) tasks = mergeTask(tasks, t);
        set({ tasks, notice: `${archivedTasks.length} picklist(s) archived.` });
        if (isSupabaseConfigured) {
          for (const t of archivedTasks) {
            try {
              await updateTaskData(t);
            } catch (e) {
              set({ notice: "Could not archive " + t.no + ": " + (e as Error).message });
            }
          }
        }
        return archivedTasks.length;
      },
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
        channelBuckets: s.channelBuckets,
        facilityPriority: s.facilityPriority,
        pickers: s.pickers,
        visibleFacilities: s.visibleFacilities,
        savedInventoryViews: s.savedInventoryViews,
        partnerActive: s.partnerActive,
        partnerLogos: s.partnerLogos,
        auditLog: s.auditLog,
      }),
    },
  ),
);

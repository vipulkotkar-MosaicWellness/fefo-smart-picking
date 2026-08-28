import { create } from "zustand";
import { persist } from "zustand/middleware";
import { bucketCode, channelCode, CHANNELS, type ChannelBucket } from "./channels";
import { allocate, cutoffMonths } from "./engine";
import { FACILITY_GATE_PASS_PREFIX, FACILITY_PRIORITY, facilityCode, gatePassMatchesFacility } from "./facilities";
import { matchesCutoff } from "./dateRanges";
import { activeHoldKeys, dueForHoldAutoRelease, holdKey, holdsToCreate } from "./holds";
import { fetchHolds, insertHold, releaseHoldRow } from "./holdsSupabase";
import { dequeue as dequeuePick, enqueue as enqueuePick, loadQueue as loadPickQueue } from "./offlineQueue";
import { rowsFromTuples, type StockTuple } from "./sampleData";
import { REAL_STOCK } from "./stockSnapshot";
import { isSupabaseConfigured } from "./supabaseClient";
import type { ShelfwiseStockRow } from "./shelfwiseCsv";
import { fetchStock, fetchSyncState, replaceStock } from "./supabaseStock";
import type { SyncSource } from "./syncSource";
import { deletePickerRow, fetchPickers, insertPicker, renamePickerRow, subscribePickers } from "./pickersSupabase";
import { fetchAllTasks, insertTask, nextSequence, subscribeTasks, updateTaskData } from "./tasksSupabase";
import type {
  BinSkip,
  ChannelRule,
  DemandLine,
  FacilityPicklist,
  Hold,
  PickingTask,
  PickLine,
  Shortfall,
  SkuInfo,
  StockRow,
} from "./types";

/** Seed names shown until an Admin adds/renames pickers for this warehouse. */
export const PICKERS_DEFAULT = ["Ravi", "Sunil", "Amit"];

// Optional: the deployed Apps Script Web App /exec URL (with ?token=... already
// appended) that lets "Sync now" run the ingest on demand instead of only
// re-reading whatever Supabase already has. See apps-script/ShelfwiseIngest.gs
// doGet(). Sync now still works without this set — it just can't force a fresh
// pull, only re-read the last thing the hourly trigger actually wrote.
const INGEST_TRIGGER_URL = (import.meta.env.VITE_INGEST_TRIGGER_URL as string | undefined) || "";

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

/**
 * Every facility picklist actually in play right now: parent task not
 * archived, AND the facility picklist itself not discarded. Discarding is a
 * separate, per-facility-picklist feature from archiving a whole task — see
 * the comment on FacilityPicklist.discarded — but both need to disappear
 * from the same operational surfaces (queue, picker's own list, reservation
 * math), so this is the one place that combines them.
 */
export function activeFacilityLists(tasks: PickingTask[]): FacilityPicklist[] {
  return allFacilityLists(activeTasks(tasks)).filter((f) => !f.discarded);
}

/**
 * The gate pass number that actually applies to this facility picklist —
 * its own (set per-facility, the normal case going forward) falling back to
 * the parent task's legacy single gatePassNo, for data created before gate
 * passes moved to being per-facility. Always read gate pass through this,
 * never `f.gatePassNo` directly, so old and new data display identically.
 */
export function effectiveGatePassNo(f: FacilityPicklist, task: PickingTask | undefined): string | undefined {
  return f.gatePassNo ?? task?.gatePassNo;
}

/** A facility picklist generated but held back from Picking until a matching gate pass is supplied. */
export function gatePassPending(f: FacilityPicklist, task: PickingTask | undefined): boolean {
  return !effectiveGatePassNo(f, task);
}

/**
 * Every facility picklist that's actually reached the Picking Supervisor —
 * activeFacilityLists() minus anything still "Gate Pass Allocation Pending".
 * A pending facility is fully allocated (stock reserved, so it still counts
 * for reservedFor()/activeFacilityLists() itself) but deliberately invisible
 * here until someone supplies its gate pass — see setFacilityGatePass.
 */
export function supervisorVisibleFacilityLists(tasks: PickingTask[]): FacilityPicklist[] {
  const taskByNo = new Map(tasks.map((t) => [t.no, t] as const));
  return activeFacilityLists(tasks).filter((f) => !gatePassPending(f, taskByNo.get(f.taskNo)));
}

/** Facility picklists still awaiting a gate pass number — the Demand Planner's pending queue. */
export function pendingGatePassFacilityLists(tasks: PickingTask[]): FacilityPicklist[] {
  const taskByNo = new Map(tasks.map((t) => [t.no, t] as const));
  return activeFacilityLists(tasks).filter((f) => f.status !== "completed" && gatePassPending(f, taskByNo.get(f.taskNo)));
}

/**
 * A line still reserves stock until it has actually been picked. Archived
 * tasks and discarded facility picklists never reserve. Matched by
 * sku+facility+bin+batch identity (the same key format as holdKey), NOT by
 * the stock row's `rid` — that internal ID is reassigned on every stock
 * resync (no stable ordering on the fetch, and the Apps Script does a full
 * delete+reinsert hourly), so an open line's `rid` can silently point at an
 * unrelated physical lot after the next sync.
 */
export function reservedFor(tasks: PickingTask[], key: string): number {
  let r = 0;
  for (const f of activeFacilityLists(tasks)) {
    for (const l of f.lines) {
      if (l.picked != null) continue;
      if (holdKey(l.sku, l.facility, l.bin, l.batch) === key) r += l.qty;
    }
  }
  return r;
}

export function facilityDone(f: FacilityPicklist): boolean {
  return f.lines.every((l) => l.picked != null);
}

/**
 * How long after a picklist is CREATED the WMS block ("Gatepass Generated")
 * auto-fires — regardless of whether a picker has been assigned to it yet.
 * (Earlier version keyed this off picker assignment instead; changed once
 * Creation Pending and Picking Pending were merged into one bucket, since
 * there's no longer a meaningfully distinct "not yet assigned" state to key
 * off — see dueForWmsBlock.)
 */
export const WMS_BLOCK_DELAY_MS = 15 * 60 * 1000;

/**
 * Every assignment action (assignAll/assignLine/uploadAssignments) calls this
 * on the facility it touches. assignedAt is stamped once, on the FIRST
 * assignment only — purely for the time-motion record (Created → Assigned →
 * Gatepass Generated → Completed); it no longer drives the WMS-block clock,
 * which is keyed off creation instead (see WMS_BLOCK_DELAY_MS). It still
 * clears an existing revoke on reassignment, so "stays revoked until picker
 * reassigned" continues to hold — a reassignment after a revoke re-arms the
 * block, which (since creation was necessarily already 15+ minutes ago by
 * then) fires again on the very next sweep rather than after a fresh wait.
 */
export function stampAssignment(f: FacilityPicklist): FacilityPicklist {
  if (f.wmsRevokedAt) {
    return { ...f, wmsBlocked: false, wmsBlockedAt: undefined, wmsRevokedAt: undefined, wmsRevokedBy: undefined, assignedAt: f.assignedAt ?? new Date().toISOString() };
  }
  if (!f.assignedAt) return { ...f, assignedAt: new Date().toISOString() };
  return f;
}

/**
 * Facilities whose CREATION clock has run past WMS_BLOCK_DELAY_MS and
 * haven't already been blocked or revoked — what checkWmsAutoBlock() sweeps
 * every minute. Fires whether or not a picker is assigned yet. Completed/
 * discarded/archived picklists are excluded via activeFacilityLists since
 * there's nothing left to block.
 */
export function dueForWmsBlock(tasks: PickingTask[], now = Date.now()): FacilityPicklist[] {
  const taskByNo = new Map(tasks.map((t) => [t.no, t] as const));
  return activeFacilityLists(tasks).filter((f) => {
    if (f.status === "completed" || f.wmsBlocked || f.wmsRevokedAt) return false;
    // Never released to the Supervisor/WMS yet — nothing there to have reserved.
    if (gatePassPending(f, taskByNo.get(f.taskNo))) return false;
    const created = f.createdAt ?? taskByNo.get(f.taskNo)?.createdAt;
    if (!created) return false;
    return now - new Date(created).getTime() >= WMS_BLOCK_DELAY_MS;
  });
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

/**
 * Fill one SKU's need with pure FEFO across every facility at once — no
 * facility-priority ordering. `allocate()` pools all eligible stock and
 * sorts purely by expiry when `location` is omitted, so a SKU's demand can
 * split across facilities purely because that's where the earliest stock
 * actually is, never because one facility is ranked ahead of another. The
 * resulting lines already carry their own `.facility`, grouped here only for
 * buildFacilityLists' sake.
 */
function allocateAcrossFacilities(
  sku: string,
  need: number,
  cutoff: number,
  stock: StockRow[],
  reserved: (key: string) => number,
  exclude: number[],
  heldKeys: Set<string>,
  minQty?: number,
): { byFacility: Record<string, PickLine[]>; short: number; skipped: BinSkip[] } {
  const r = allocate({ sku, need, cutoff, stock, reservedFor: reserved, exclude, heldKeys, minQty });
  const byFacility: Record<string, PickLine[]> = {};
  for (const line of r.lines) (byFacility[line.facility] ??= []).push(line);
  return { byFacility, short: r.short, skipped: r.skipped };
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
  demand: DemandLine[]; // this group's original demand rows — generate() persists these onto the created task
  byFacility: Record<string, PickLine[]>;
  shortfall: Shortfall[];
  skipped: BinSkip[];
  // Resolved per facility actually used — a facility key present in
  // byFacility but absent (undefined) here is "Gate Pass Allocation
  // Pending": generated and fully allocated, but held back from the Picking
  // Supervisor queue until someone supplies a matching gate pass. Reconciled
  // strictly by prefix (see gatePassMatchesFacility) — a gate pass supplied
  // for one facility is NEVER applied to a different one, even if that's
  // the only facility this order actually allocated to.
  gatePassByFacility: Record<string, string | undefined>;
  // Gate pass numbers the Planner supplied that matched no facility this
  // order actually used — surfaced so it's obvious the number wasn't
  // silently dropped, e.g. "you gave a Mother Hub gate pass but this order
  // only allocated to Ambient."
  unusedGatePasses: string[];
}

const GATE_PASS_PENDING = "__PENDING__";

export function gatePassGroupKey(d: DemandLine): string {
  return `${d.channel}::${d.gatePassNo?.trim() || GATE_PASS_PENDING}`;
}

/**
 * Matches each facility actually allocated to (a key in byFacility) against
 * whichever of the group's originally-supplied gate pass numbers has a
 * matching prefix — see FACILITY_GATE_PASS_PREFIX. A facility with no
 * matching candidate is left unresolved (pending); a supplied gate pass
 * that matches no allocated facility is reported back as unused rather than
 * silently discarded.
 */
function reconcileGatePasses(
  facilitiesUsed: string[],
  providedGatePasses: string[],
): { gatePassByFacility: Record<string, string | undefined>; unusedGatePasses: string[] } {
  const gatePassByFacility: Record<string, string | undefined> = {};
  const used = new Set<string>();
  for (const facility of facilitiesUsed) {
    const match = providedGatePasses.find((gp) => !used.has(gp) && gatePassMatchesFacility(gp, facility));
    if (match) {
      gatePassByFacility[facility] = match;
      used.add(match);
    } else {
      gatePassByFacility[facility] = undefined;
    }
  }
  return { gatePassByFacility, unusedGatePasses: providedGatePasses.filter((gp) => !used.has(gp)) };
}

/**
 * Pure FEFO allocation for a demand list, grouped by (channel, gate pass) —
 * rows sharing a supplied gate pass number group together as before; rows
 * with none supplied, within one channel in one upload, become a single
 * pending order (see gatePassGroupKey). Allocation itself pools stock
 * across every facility and fills strictly by expiry — no facility-priority
 * ordering; a SKU's demand can split across facilities purely because
 * that's where the earliest stock is. Which facility gets which of the
 * group's supplied gate pass numbers (if any) is resolved afterward by
 * prefix — see reconcileGatePasses. No Supabase, no store mutation, no
 * numbering. `generate()` uses this to build real tasks; the Demand
 * Planner's "review allocation" step calls the same function to preview, so
 * preview and generate can never disagree.
 */
export function computeChannelAllocations(
  demand: DemandLine[],
  channelRules: Record<string, ChannelRule>,
  skus: Record<string, SkuInfo>,
  stock: StockRow[],
  existingTasks: PickingTask[],
  heldKeys: Set<string> = new Set(),
): ChannelAllocation[] {
  const byGroup = new Map<string, DemandLine[]>();
  for (const d of demand) {
    const key = gatePassGroupKey(d);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(d);
  }

  const reserved = (key: string) => reservedFor(existingTasks, key);
  const out: ChannelAllocation[] = [];
  for (const lines of byGroup.values()) {
    const channel = lines[0].channel;
    const rule = channelRules[channel];
    if (!rule) continue;
    const byFacility: Record<string, PickLine[]> = {};
    const shortfall: Shortfall[] = [];
    const skipped: BinSkip[] = [];
    for (const d of lines) {
      const cutoff = cutoffMonths(rule, skus[d.sku].shelf);
      const w = allocateAcrossFacilities(d.sku, d.qty, cutoff, stock, reserved, [], heldKeys, rule.minBinQty);
      for (const f of Object.keys(w.byFacility)) (byFacility[f] ??= []).push(...w.byFacility[f]);
      if (w.short > 0) shortfall.push({ sku: d.sku, name: skus[d.sku].name, qty: w.short });
      skipped.push(...w.skipped);
    }
    const providedGatePasses = [...new Set(lines.map((d) => d.gatePassNo?.trim()).filter((gp): gp is string => !!gp))];
    const { gatePassByFacility, unusedGatePasses } = reconcileGatePasses(Object.keys(byFacility), providedGatePasses);
    out.push({ channel, demand: lines, byFacility, shortfall, skipped, gatePassByFacility, unusedGatePasses });
  }
  return out;
}

function buildFacilityLists(
  taskNo: string,
  round: number,
  byFacility: Record<string, PickLine[]>,
  priority: string[],
  suffix = "",
  gatePassByFacility: Record<string, string | undefined> = {},
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
      gatePassNo: gatePassByFacility[f],
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
  // Names removed via deleteChannel() — including built-in ones. Tracked
  // separately (not just absence from channelRules) because the persist
  // merge() re-adds any built-in CHANNELS default that's missing from a
  // browser's cached state, so a plain removal would silently reappear on
  // the next load; this list is checked after that merge to keep a deletion
  // actually stuck.
  deletedChannels: string[];
  facilityPriority: string[];
  pickers: string[];
  holds: Hold[];
  lastSync: string;
  lastSyncSource: SyncSource;
  lastSyncBy: string | null;
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
  syncStock: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
  loadStock: (tuples: StockTuple[]) => void;
  uploadStockFallback: (rows: ShelfwiseStockRow[], uploadedBy: string) => Promise<boolean>;
  loadTasks: () => Promise<void>;
  startTasksRealtime: () => () => void;
  // Pickers are shared across every logged-in user (see pickersSupabase.ts) —
  // NOT the same kind of local-only setting as channelRules/facilityPriority.
  loadPickers: () => Promise<void>;
  startPickersRealtime: () => () => void;
  addPicker: (name: string) => Promise<void>;
  renamePicker: (oldName: string, newName: string) => Promise<void>;
  removePicker: (name: string) => Promise<void>;
  loadHolds: () => Promise<void>;
  placeHold: (h: { sku: string; facility: string; bin: string; batch: string; qty: number; heldBy: string; reason?: string; sourceTaskNo?: string }) => Promise<void>;
  releaseHold: (id: number, releasedBy: string) => Promise<void>;
  setDemand: (d: DemandLine[]) => void;
  removeDemand: (i: number) => void;
  generate: (createdBy: string | null, createdByName: string | null) => Promise<void>;
  assignAll: (facilityNo: string, picker: string) => Promise<void>;
  assignLine: (rid: number, facilityNo: string, picker: string) => Promise<void>;
  uploadAssignments: (facilityNo: string, text: string) => Promise<void>;
  applyPicks: (facilityNo: string, results: Record<number, number>, reasons?: Record<number, string>, heldBy?: string) => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
  updateChannelRule: (channel: string, rule: ChannelRule) => void;
  addChannel: (name: string, bucket: ChannelBucket, rule: ChannelRule) => void;
  // Super Admin only (enforced in the UI, same pattern as removePicker) —
  // removes a channel from the dispatch-tolerance list, built-in or custom.
  // Existing tasks already created under that channel keep their data; this
  // only stops it being offered for new demand going forward.
  deleteChannel: (name: string) => void;
  archiveTask: (taskNo: string) => Promise<void>;
  unarchiveTask: (taskNo: string) => Promise<void>;
  archiveAllActiveTasks: () => Promise<void>;
  unarchiveAllTasks: () => Promise<void>;
  archiveByCutoff: (cutoffDate: string, direction: "before" | "after") => Promise<number>;
  // A separate feature from archive: cancels one specific facility picklist
  // (only while still open) and frees its reserved stock, rather than
  // hiding a whole gate pass regardless of pick status.
  discardFacilityPicklist: (taskNo: string, facilityNo: string, revokedBy?: string) => Promise<void>;
  undiscardFacilityPicklist: (taskNo: string, facilityNo: string) => Promise<void>;
  // Resolves a "Gate Pass Allocation Pending" facility picklist — validates
  // the number's prefix against the facility (see gatePassMatchesFacility)
  // before ever setting it. Only on success does the facility become
  // visible to the Picking Supervisor queue for the first time.
  setFacilityGatePass: (taskNo: string, facilityNo: string, gatePassNo: string) => Promise<{ ok: boolean; error?: string }>;
  // Admin/Super Admin only — reverses an auto-fired WMS block. Stays revoked
  // until the picklist is reassigned to a picker (see stampAssignment).
  revokeWmsBlock: (taskNo: string, facilityNo: string, revokedBy: string) => Promise<void>;
  // Sweeps every open, assigned, not-yet-blocked facility and fires the WMS
  // block on any whose 15-minute clock has run out. Client-side only — see
  // WMS_BLOCK_DELAY_MS; called on an interval from App.tsx.
  checkWmsAutoBlock: () => Promise<void>;
  // Sweeps active holds and genuinely releases (releasedBy: "System (shelf
  // emptied)") any whose lot has hit 0 current qty — see
  // dueForHoldAutoRelease. Called on the same interval as checkWmsAutoBlock.
  checkHoldAutoRelease: () => Promise<void>;
}

const initialStock = rowsFromTuples(REAL_STOCK);

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      stock: initialStock,
      skus: skusFromStock(initialStock),
      channelRules: { ...CHANNELS },
      channelBuckets: {},
      deletedChannels: [],
      facilityPriority: [...FACILITY_PRIORITY],
      pickers: [...PICKERS_DEFAULT],
      holds: [],
      lastSync: new Date().toISOString(),
      lastSyncSource: null,
      lastSyncBy: null,
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
      // Once WMS has blocked the stock (wmsBlocked), that reservation no
      // longer depends on our own picklist state, so it stops holding up the
      // hourly sync — even if physical picking on the rest of the lines
      // hasn't finished yet. See FacilityPicklist.wmsBlocked in types.ts.
      anyOpen: () => activeFacilityLists(get().tasks).some((f) => !f.wmsBlocked && f.lines.some((l) => l.picked == null)),
      toggleFacility: (f) =>
        set({
          visibleFacilities: get().visibleFacilities.includes(f)
            ? get().visibleFacilities.filter((x) => x !== f)
            : [...get().visibleFacilities, f],
        }),

      loadPickers: async () => {
        if (!isSupabaseConfigured) return;
        try {
          const pickers = await fetchPickers();
          set({ pickers });
        } catch {
          // Transient failure — keep whatever's already in state.
        }
      },

      startPickersRealtime: () => {
        if (!isSupabaseConfigured) return () => {};
        return subscribePickers(() => void get().loadPickers());
      },

      addPicker: async (name) => {
        const trimmed = name.trim();
        if (!trimmed || get().pickers.includes(trimmed)) return;
        set({ pickers: [...get().pickers, trimmed] });
        if (isSupabaseConfigured) {
          try {
            await insertPicker(trimmed);
          } catch (e) {
            set({ notice: "Could not save picker " + trimmed + ": " + (e as Error).message });
          }
        }
      },

      // Renames the picker everywhere: the shared managed list, and every
      // not-yet-picked line already assigned to their old name (so in-flight
      // assignments keep matching correctly instead of orphaning).
      renamePicker: async (oldName, newName) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName) return;
        set({ pickers: get().pickers.map((p) => (p === oldName ? trimmed : p)) });
        if (isSupabaseConfigured) {
          try {
            await renamePickerRow(oldName, trimmed);
          } catch (e) {
            set({ notice: "Could not rename picker " + oldName + ": " + (e as Error).message });
          }
        }

        const affected = get().tasks.filter((t) => t.facilities.some((f) => f.lines.some((l) => l.picker === oldName)));
        let tasks = get().tasks;
        for (const t of affected) {
          const updated: PickingTask = {
            ...t,
            facilities: t.facilities.map((f) => ({
              ...f,
              lines: f.lines.map((l) => (l.picker === oldName ? { ...l, picker: trimmed } : l)),
            })),
          };
          tasks = mergeTask(tasks, updated);
        }
        set({ tasks });
        if (isSupabaseConfigured) {
          for (const t of tasks.filter((t) => affected.some((a) => a.no === t.no))) {
            try {
              await updateTaskData(t);
            } catch (e) {
              set({ notice: "Could not rename picker on " + t.no + ": " + (e as Error).message });
            }
          }
        }
      },

      removePicker: async (name) => {
        set({ pickers: get().pickers.filter((p) => p !== name) });
        if (isSupabaseConfigured) {
          try {
            await deletePickerRow(name);
          } catch (e) {
            set({ notice: "Could not remove picker " + name + ": " + (e as Error).message });
          }
        }
      },

      loadHolds: async () => {
        if (!isSupabaseConfigured) return;
        try {
          const holds = await fetchHolds();
          set({ holds });
        } catch (e) {
          set({ notice: "Could not load stock holds: " + (e as Error).message });
        }
      },

      placeHold: async (h) => {
        const key = holdKey(h.sku, h.facility, h.bin, h.batch);
        if (activeHoldKeys(get().holds).has(key)) return; // already on hold, nothing to do
        if (!isSupabaseConfigured) return;
        try {
          await insertHold(h);
          await get().loadHolds();
        } catch (e) {
          set({ notice: "Could not place hold: " + (e as Error).message });
        }
      },

      releaseHold: async (id, releasedBy) => {
        if (!isSupabaseConfigured) return;
        try {
          await releaseHoldRow(id, releasedBy);
          await get().loadHolds();
        } catch (e) {
          set({ notice: "Could not release hold: " + (e as Error).message });
        }
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
      //
      // Re-reading Supabase alone can't produce anything newer than whatever
      // the hourly Apps Script trigger last actually wrote — on a busy day it
      // may not get a single clear (unfrozen) hour all day, so "Sync now"
      // could otherwise sit showing stale data no matter how many times it's
      // clicked. When INGEST_TRIGGER_URL is configured, this calls the same
      // ingest() the hourly trigger runs, on demand, right now — then reads
      // back whatever Supabase ends up with either way.
      syncStock: async () => {
        if (get().anyOpen()) {
          set({ notice: "⚠ Feed frozen — complete open picking before syncing." });
          return;
        }
        if (isSupabaseConfigured) {
          if (INGEST_TRIGGER_URL) {
            set({ syncing: true, notice: "Requesting a fresh pull from the inventory feed…" });
            try {
              // no-cors: Apps Script Web App responses aren't reliably
              // readable cross-origin. We can't read the result, but the
              // ingest still runs server-side; loadFromSupabase() right
              // after reads back whatever it actually did (synced, frozen,
              // or no new email — all handled the same way today already).
              await fetch(INGEST_TRIGGER_URL, { method: "GET", mode: "no-cors" });
            } catch {
              // Network hiccup reaching the trigger — still worth reading
              // whatever's currently in Supabase rather than giving up.
            }
            await new Promise((resolve) => setTimeout(resolve, 4000));
          }
          await get().loadFromSupabase();
          return;
        }
        const stock = rowsFromTuples(REAL_STOCK);
        set({ stock, skus: skusFromStock(stock), lastSync: new Date().toISOString(), lastSyncSource: null, lastSyncBy: null, notice: "✓ Stock reloaded from snapshot." });
      },

      loadFromSupabase: async () => {
        if (!isSupabaseConfigured) return;
        const prevLast = get().lastSync;
        set({ syncing: true, notice: "Checking for new stock…" });
        try {
          const rows = await fetchStock();
          const syncState = await fetchSyncState();
          const changed = syncState.lastSynced && syncState.lastSynced !== prevLast;
          set({
            stock: rows,
            skus: skusFromStock(rows),
            lastSync: syncState.lastSynced ?? new Date().toISOString(),
            lastSyncSource: syncState.source,
            lastSyncBy: syncState.updatedBy,
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
        set({ stock, skus: skusFromStock(stock), lastSync: new Date().toISOString(), lastSyncSource: null, lastSyncBy: null });
      },

      // Admin/Super Admin fallback for when the hourly Shelfwise pipeline is
      // down — replaces the shared stock table directly, same freeze rule as
      // the automated sync so it can't shift stock under an active picker.
      uploadStockFallback: async (rows, uploadedBy) => {
        if (get().anyOpen()) {
          set({ notice: "⚠ Feed frozen — complete open picking before uploading." });
          return false;
        }
        if (!isSupabaseConfigured) {
          set({ notice: "✗ Upload requires Supabase to be configured." });
          return false;
        }
        set({ syncing: true, notice: `Uploading ${rows.length.toLocaleString()} row(s)…` });
        try {
          await replaceStock(rows, uploadedBy);
          await get().loadFromSupabase();
          set({ notice: `✓ Inventory replaced — ${rows.length.toLocaleString()} row(s) uploaded.` });
          return true;
        } catch (e) {
          set({ syncing: false, notice: "✗ Upload failed: " + (e as Error).message });
          return false;
        }
      },

      setDemand: (d) => set({ demand: d }),
      removeDemand: (i) => set({ demand: get().demand.filter((_, idx) => idx !== i) }),

      // One picking task per (channel, gate pass) present in the demand list,
      // created together so a single multi-channel CSV upload queues
      // multiple picklists at once. Internal task numbers keep working as
      // before (needed for FEFO reservation + Alternate Picklist linking).
      // Gate pass is now per-facility (see FacilityPicklist.gatePassNo) —
      // a facility with no matching one goes into "Gate Pass Allocation
      // Pending" instead of getting a task-level label.
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

        const allocations = computeChannelAllocations(demand, channelRules, skus, stock, activeTasks(tasks), activeHoldKeys(get().holds));
        const newTasks: PickingTask[] = [];
        const allUnusedGatePasses: string[] = [];
        let pendingCount = 0;

        for (const { channel, demand: groupDemand, byFacility, shortfall, skipped, gatePassByFacility, unusedGatePasses } of allocations) {
          const prefix = taskNumberPrefix(channel, get().channelBuckets);
          const seq = isSupabaseConfigured ? await nextSequence(prefix) : newTasks.length + 1;
          const no = `${prefix}${String(seq).padStart(3, "0")}`;
          allUnusedGatePasses.push(...unusedGatePasses);
          pendingCount += Object.values(gatePassByFacility).filter((gp) => !gp).length;
          newTasks.push({
            no,
            channel,
            demand: JSON.parse(JSON.stringify(groupDemand)),
            facilities: buildFacilityLists(no, 1, byFacility, facilityPriority, "", gatePassByFacility),
            shortfall,
            binSkips: skipped.length ? skipped : undefined,
            createdAt: new Date().toISOString(),
            createdByName: createdByName ?? undefined,
          });
        }

        const pendingNote = pendingCount > 0 ? ` ${pendingCount} facility picklist(s) awaiting gate pass allocation.` : "";
        const unusedNote = allUnusedGatePasses.length > 0 ? ` Not used (no matching facility): ${[...new Set(allUnusedGatePasses)].join(", ")}.` : "";
        set({
          tasks: [...tasks, ...newTasks],
          demand: [],
          notice: `${newTasks.length} picking task(s) created — ${newTasks.map((t) => t.no).join(", ")}.${pendingNote}${unusedNote}`,
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
          const next = {
            ...t,
            facilities: t.facilities.map((f) =>
              f.no === facilityNo ? { ...stampAssignment(f), lines: f.lines.map((l) => ({ ...l, picker })) } : f,
            ),
          };
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
              f.no === facilityNo
                ? { ...stampAssignment(f), lines: f.lines.map((l) => (l.rid === rid ? { ...l, picker } : l)) }
                : f,
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
              f.no === facilityNo
                ? { ...stampAssignment(f), lines: f.lines.map((l) => (map[l.bin] ? { ...l, picker: map[l.bin] } : l)) }
                : f,
            ),
          };
          changed = next;
          return next;
        });
        set({ tasks, notice: "Assignments uploaded." });
        if (isSupabaseConfigured && changed) await updateTaskData(changed);
      },

      applyPicks: async (facilityNo, results, reasons, heldBy) => {
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
            const finished: FacilityPicklist = {
              ...f,
              status: "completed",
              pickedTotal: picked,
              bad,
              gp: "GP-" + String(100000 + gpSeq * 137).slice(0, 6),
              completedAt: new Date().toISOString(),
            };
            completedFacility = finished;
            parentTask = t;
            return finished;
          });
          return { ...t, facilities };
        });

        // channelRules lives in each browser's own localStorage (see partialize
        // below), not Supabase — a channel added on one device isn't visible on
        // another's until that browser reopens/re-adds it. Missing a rule here
        // must never crash the whole completion (it used to: cutoffMonths(undefined,
        // ...) threw, so the entire applyPicks call failed before its set() ever
        // ran — the picklist looked stuck, nothing had actually saved). Skip the
        // not-found re-offer for this channel and say so instead; the completion
        // itself (stock deduction, gate pass, holds) still goes through below.
        let missingRuleNotice = "";
        if (completedFacility && parentTask && completedFacility.bad > 0 && !state.channelRules[parentTask.channel]) {
          missingRuleNotice = ` ⚠ "${parentTask.channel}" has no channel rule on this device — not-found items weren't auto re-offered. Open Admin → Channels here, or handle the shortfall manually.`;
        }
        if (completedFacility && parentTask && completedFacility.bad > 0 && state.channelRules[parentTask.channel]) {
          const task = parentTask;
          const rule = state.channelRules[task.channel];
          const usedRids = new Set(task.facilities.flatMap((f) => f.lines.map((l) => l.rid)));
          const nfBySku: Record<string, number> = {};
          completedFacility.lines.forEach((l) => { if (l.nf) nfBySku[l.sku] = (nfBySku[l.sku] ?? 0) + l.nf; });
          const r2: Record<string, PickLine[]> = {};
          const extraShort: Shortfall[] = [];
          const extraSkipped: BinSkip[] = [];
          const reserved = (key: string) => reservedFor(tasks, key);
          const heldKeysForRound2 = activeHoldKeys(state.holds);
          for (const sku of Object.keys(nfBySku)) {
            const cutoff = cutoffMonths(rule, state.skus[sku].shelf);
            const w = allocateAcrossFacilities(sku, nfBySku[sku], cutoff, stock, reserved, [...usedRids], heldKeysForRound2, rule.minBinQty);
            for (const f of Object.keys(w.byFacility)) {
              (r2[f] ??= []).push(...w.byFacility[f]);
              w.byFacility[f].forEach((l) => usedRids.add(l.rid));
            }
            if (w.short > 0) extraShort.push({ sku, name: state.skus[sku].name, qty: w.short });
            extraSkipped.push(...w.skipped);
          }
          // Round-2 (not-found re-offer) picklists aren't a new order — they
          // reuse whatever gate pass that facility already has on this task
          // from round 1, so they never land in "Gate Pass Allocation
          // Pending" for stock that was already cleared to pick. A facility
          // round 2 lands on that round 1 never used still correctly falls
          // through to pending, since it has no round-1 entry to inherit from.
          const gatePassByFacility: Record<string, string | undefined> = {};
          task.facilities.forEach((f) => {
            const gp = effectiveGatePassNo(f, task);
            if (gp) gatePassByFacility[f.facility] = gp;
          });
          // Next round, not always "2" — completing an already-round-2 (or
          // later) facility with a fresh not-found qty must produce round 3,
          // 4, etc., each with its own suffix. Hardcoding round 2/"-R2" here
          // meant a second not-found event on the same facility tried to
          // reuse the exact `no` of the facility just completed, so the
          // "round 3" silently landed as a same-`no` duplicate entry in
          // `facilities` instead of a distinct, visible picklist — refreshing
          // could never surface it because nothing was actually missing, it
          // was just unreachable under a collided id.
          const nextRound = completedFacility.round + 1;
          const r2Lists = buildFacilityLists(task.no, nextRound, r2, state.facilityPriority, `-R${nextRound}`, gatePassByFacility);
          if (r2Lists.length || extraShort.length || extraSkipped.length) {
            tasks = tasks.map((t) =>
              t.no === task.no
                ? { ...t, facilities: [...t.facilities, ...r2Lists], shortfall: [...t.shortfall, ...extraShort], binSkips: [...(t.binSkips ?? []), ...extraSkipped] }
                : t,
            );
          }
        }

        set({ tasks, stock, gpSeq, notice: `${facilityNo} updated.${missingRuleNotice}` });

        if (completedFacility) {
          const requests = holdsToCreate(completedFacility.lines, completedFacility.facility, parentTask?.no ?? facilityNo, activeHoldKeys(get().holds), stock);
          // Sequential, not Promise.all: each placeHold() re-fetches holds from
          // Supabase afterward, so awaiting one at a time keeps that re-fetch
          // authoritative instead of racing on fetch-completion order.
          for (const req of requests) {
            await get().placeHold({ ...req, heldBy: heldBy || "Unknown" });
          }
        }

        const finalTask = tasks.find((t) => t.no === (parentTask?.no ?? ""));
        if (isSupabaseConfigured && finalTask) {
          try {
            await updateTaskData(finalTask);
            // The feed may have just unfrozen (this was the last open line) —
            // pull in whatever stock the automated sync has already received,
            // instead of waiting for someone to notice and click "Sync now".
            if (!get().anyOpen()) void get().loadFromSupabase();
          } catch {
            // Offline or a transient failure — the pick is already applied
            // locally above; queue the sync so it isn't silently lost.
            enqueuePick({ facilityNo, results });
            const offlineMsg = "⚠ Saved on this device — will sync once you're back online.";
            const priorNotice = get().notice;
            set({ notice: priorNotice.startsWith("Could not place hold") ? `${priorNotice} Also: ${offlineMsg}` : offlineMsg });
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
          deletedChannels: get().deletedChannels.filter((c) => c !== name), // re-adding after a delete un-deletes it
        }),
      deleteChannel: (name) => {
        const { [name]: _removedRule, ...channelRules } = get().channelRules;
        const { [name]: _removedBucket, ...channelBuckets } = get().channelBuckets;
        set({
          channelRules,
          channelBuckets,
          deletedChannels: get().deletedChannels.includes(name) ? get().deletedChannels : [...get().deletedChannels, name],
        });
      },
      archiveTask: async (taskNo) => {
        const updated = get().tasks.find((t) => t.no === taskNo);
        if (!updated) return;
        const archived = { ...updated, archived: true };
        set({ tasks: mergeTask(get().tasks, archived) });
        if (isSupabaseConfigured) await updateTaskData(archived);
        if (!get().anyOpen()) void get().loadFromSupabase();
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
        if (!get().anyOpen()) void get().loadFromSupabase();
      },

      unarchiveAllTasks: async () => {
        const toRestore = get().tasks.filter((t) => t.archived);
        if (toRestore.length === 0) return;
        const restoredTasks = toRestore.map((t) => ({ ...t, archived: false }));
        let tasks = get().tasks;
        for (const t of restoredTasks) tasks = mergeTask(tasks, t);
        set({ tasks, notice: `${restoredTasks.length} picklist(s) unarchived.` });
        if (isSupabaseConfigured) {
          for (const t of restoredTasks) {
            try {
              await updateTaskData(t);
            } catch (e) {
              set({ notice: "Could not unarchive " + t.no + ": " + (e as Error).message });
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
        if (!get().anyOpen()) void get().loadFromSupabase();
        return archivedTasks.length;
      },

      // Cancels one facility picklist while it's still open — never a
      // completed one, that's the whole point of "pending for picking
      // only." Frees the stock it was reserving, same as archiving does,
      // but leaves the rest of the gate pass (other facilities) untouched.
      discardFacilityPicklist: async (taskNo, facilityNo, revokedBy) => {
        const task = get().tasks.find((t) => t.no === taskNo);
        if (!task) return;
        const target = task.facilities.find((f) => f.no === facilityNo);
        if (!target) return;
        if (target.status === "completed") {
          set({ notice: "✗ Can't discard a completed picklist." });
          return;
        }
        // A picklist still awaiting its gate pass was never released to the
        // Supervisor/WMS, so any wmsBlocked flag on it is spurious (an
        // artifact of the 15-minute auto-block sweep firing before gate pass
        // pending was excluded — see dueForWmsBlock) rather than a real
        // external reservation. Safe to clear it in the same transaction as
        // the discard, in one write, instead of forcing a separate revoke step.
        const spuriousBlock = target.wmsBlocked && gatePassPending(target, task);
        // Otherwise WMS already owns this reservation externally — discarding
        // would free it in our own system while WMS still holds it, a real
        // inventory mismatch between the two. Admin must revoke the WMS
        // block first, which is its own explicit, audited action.
        if (target.wmsBlocked && !spuriousBlock) {
          set({ notice: "✗ Can't discard — inventory is blocked in WMS. Revoke the WMS block first." });
          return;
        }
        const updated = {
          ...task,
          facilities: task.facilities.map((f) =>
            f.no === facilityNo
              ? {
                  ...f,
                  discarded: true,
                  ...(spuriousBlock
                    ? { wmsBlocked: false, wmsRevokedAt: new Date().toISOString(), wmsRevokedBy: revokedBy ?? "System (auto-revoked — never released to WMS)" }
                    : {}),
                }
              : f,
          ),
        };
        set({ tasks: mergeTask(get().tasks, updated) });
        if (isSupabaseConfigured) await updateTaskData(updated);
        if (!get().anyOpen()) void get().loadFromSupabase();
      },

      undiscardFacilityPicklist: async (taskNo, facilityNo) => {
        const task = get().tasks.find((t) => t.no === taskNo);
        if (!task) return;
        const updated = { ...task, facilities: task.facilities.map((f) => (f.no === facilityNo ? { ...f, discarded: false } : f)) };
        set({ tasks: mergeTask(get().tasks, updated) });
        if (isSupabaseConfigured) await updateTaskData(updated);
      },

      setFacilityGatePass: async (taskNo, facilityNo, gatePassNo) => {
        const task = get().tasks.find((t) => t.no === taskNo);
        if (!task) return { ok: false, error: "Picklist not found." };
        const target = task.facilities.find((f) => f.no === facilityNo);
        if (!target) return { ok: false, error: "Picklist not found." };
        const trimmed = gatePassNo.trim();
        if (!trimmed) return { ok: false, error: "Enter a gate pass number." };
        if (!gatePassMatchesFacility(trimmed, target.facility)) {
          const prefix = FACILITY_GATE_PASS_PREFIX[target.facility];
          return { ok: false, error: prefix ? `Gate pass for ${target.facility} must start with ${prefix}.` : `No known gate pass prefix for ${target.facility}.` };
        }
        const updated = { ...task, facilities: task.facilities.map((f) => (f.no === facilityNo ? { ...f, gatePassNo: trimmed } : f)) };
        set({ tasks: mergeTask(get().tasks, updated) });
        if (isSupabaseConfigured) await updateTaskData(updated);
        return { ok: true };
      },

      revokeWmsBlock: async (taskNo, facilityNo, revokedBy) => {
        const task = get().tasks.find((t) => t.no === taskNo);
        if (!task) return;
        const target = task.facilities.find((f) => f.no === facilityNo);
        if (!target || !target.wmsBlocked) return;
        const updated = {
          ...task,
          facilities: task.facilities.map((f) =>
            f.no === facilityNo ? { ...f, wmsBlocked: false, wmsRevokedAt: new Date().toISOString(), wmsRevokedBy: revokedBy } : f,
          ),
        };
        set({ tasks: mergeTask(get().tasks, updated) });
        if (isSupabaseConfigured) await updateTaskData(updated);
      },

      checkWmsAutoBlock: async () => {
        const due = dueForWmsBlock(get().tasks);
        if (due.length === 0) return;
        const dueKeys = new Set(due.map((f) => f.no));
        const now = new Date().toISOString();
        const touchedTasks: PickingTask[] = [];
        let tasks = get().tasks.map((t) => {
          if (!t.facilities.some((f) => dueKeys.has(f.no))) return t;
          const next = { ...t, facilities: t.facilities.map((f) => (dueKeys.has(f.no) ? { ...f, wmsBlocked: true, wmsBlockedAt: now } : f)) };
          touchedTasks.push(next);
          return next;
        });
        set({ tasks });
        if (isSupabaseConfigured) {
          for (const t of touchedTasks) await updateTaskData(t);
        }
        if (!get().anyOpen()) void get().loadFromSupabase();
      },

      checkHoldAutoRelease: async () => {
        const due = dueForHoldAutoRelease(get().holds, get().stock);
        if (due.length === 0 || !isSupabaseConfigured) return;
        for (const h of due) {
          try {
            await releaseHoldRow(h.id, "System (shelf emptied)");
          } catch {
            // Transient failure — leave it active, next sweep will retry.
          }
        }
        await get().loadHolds();
      },
    }),
    {
      name: "fefo-smart-picking-v7",
      // Default merge() replaces a top-level persisted key outright, so a
      // browser that already had channelRules/channelBuckets cached from
      // before a new built-in channel shipped would never see it — the old
      // cached object wins wholesale. Deep-merge just these two so new
      // built-in channels always appear, while anything the user actually
      // customized (their own rule edits, their own Admin-added channels)
      // is preserved and still wins over the code defaults.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const deletedChannels = p.deletedChannels ?? [];
        const merged = {
          ...current,
          ...p,
          channelRules: { ...current.channelRules, ...p.channelRules },
          channelBuckets: { ...current.channelBuckets, ...p.channelBuckets },
          deletedChannels,
        };
        // Re-applied after the merge above, since that merge would otherwise
        // resurrect a deleted built-in channel from `current`'s CHANNELS
        // defaults — see deletedChannels' definition on AppState.
        for (const name of deletedChannels) {
          delete merged.channelRules[name];
          delete merged.channelBuckets[name];
        }
        return merged;
      },
      // Stock, tasks, and pickers are not persisted locally when Supabase is
      // configured — they come live from the shared database instead (see
      // loadPickers/startPickersRealtime). Local mode (no Supabase keys)
      // keeps everything in browser storage as before.
      partialize: (s) => ({
        tasks: isSupabaseConfigured ? [] : s.tasks,
        gpSeq: s.gpSeq,
        channelRules: s.channelRules,
        channelBuckets: s.channelBuckets,
        deletedChannels: s.deletedChannels,
        facilityPriority: s.facilityPriority,
        pickers: isSupabaseConfigured ? [] : s.pickers,
        visibleFacilities: s.visibleFacilities,
        savedInventoryViews: s.savedInventoryViews,
        partnerActive: s.partnerActive,
        partnerLogos: s.partnerLogos,
        auditLog: s.auditLog,
      }),
    },
  ),
);

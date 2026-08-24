// Domain types for the FEFO Smart Picking engine.

/** Expiry as [year, month] where month is 1-12. */
export type Expiry = [number, number];

export interface StockRow {
  rid: number;
  location: string; // facility, e.g. "SL Mother Hub"
  bin: string; // shelf / bin within the facility
  sku: string;
  name: string;
  batch: string;
  exp: Expiry;
  // Full "YYYY-MM-DD" expiry when known (Supabase stores the exact date; local/
  // sample stock doesn't carry one). Purely a same-month FEFO tiebreaker — see
  // allocate() in engine.ts — never used for the shelf-life cutoff check itself,
  // which stays month-granularity since channel rules are expressed in months.
  expDate?: string;
  qty: number;
  shelf: number; // total shelf life in months
  type: string; // Inventory Type, e.g. "Good", "Damaged"
  active: string; // "Active" | "Inactive"
}

export interface SkuInfo {
  name: string;
  shelf: number;
}

export interface DemandLine {
  channel: string;
  sku: string;
  qty: number;
  // Optional — a Planner who already knows a facility's gate pass number can
  // supply it at import, but it's no longer required. Every row left blank
  // (within one channel, one upload) becomes one pending order; the actual
  // gate pass per facility gets reconciled after allocation — see
  // reconcileGatePasses in store.ts and FACILITY_GATE_PASS_PREFIX.
  gatePassNo?: string;
}

export interface PickLine {
  rid: number;
  sku: string;
  name: string;
  facility: string;
  bin: string;
  batch: string;
  exp: Expiry;
  rem: number; // remaining months at pick time
  qty: number; // suggested pick qty
  nf?: number; // not-found qty entered on completion
  nfReason?: string; // picker's reason for the not-found qty, e.g. "Damaged stock"
  picked?: number; // actual picked (qty - nf)
  picker?: string; // assigned picker (child-picklist stage)
}

export type PicklistStatus = "open" | "completed";

/** One facility's slice of a picking task (Mother Hub / Ambient / RX). */
export interface FacilityPicklist {
  no: string; // e.g. PT-260722-001-MH
  taskNo: string;
  facility: string;
  status: PicklistStatus;
  round: number; // 1 = first pass, 2 = round-2 (re-offer of not-found)
  bad: number; // qty moved to bad location / not found
  gp?: string; // gatepass number
  // The customer-facing gate pass number FOR THIS FACILITY specifically —
  // one gate pass per facility, never shared across facilities (see
  // FACILITY_GATE_PASS_PREFIX). undefined means "Gate Pass Allocation
  // Pending": this facility picklist was generated (fully allocated, bins
  // and batches picked out) but is deliberately held back from the Picking
  // Supervisor queue until someone supplies a matching gate pass number —
  // see gatePassPending() in store.ts, which is what actually gates
  // visibility, not a separate status flag. Falls back to the parent task's
  // legacy single gatePassNo for data created before this field existed —
  // see effectiveGatePassNo() in store.ts, used everywhere this is read.
  gatePassNo?: string;
  pickedTotal?: number;
  lines: PickLine[];
  createdAt?: string; // when this specific round was generated — undefined on data from before this field existed, falls back to the parent task's createdAt
  // Discarded is a DIFFERENT feature from the task-level `archived` flag on
  // PickingTask: discarding cancels one specific facility picklist (only
  // while it's still open, never once completed) and frees its reserved
  // stock; archiving hides a whole gate pass regardless of pick status.
  // Never conflate the two — separate flags, separate admin screens.
  discarded?: boolean;

  // Time-motion timestamps — one per real workflow stage, nothing invented.
  assignedAt?: string; // first-ever moment a picker was put on any line here — a historical record only, does not drive the WMS-block clock
  completedAt?: string; // when every line finished (status flipped to "completed")

  // WMS inventory block ("Gatepass Generated" on screen) — a DIFFERENT thing
  // from `gp` above. `gp` is the final gate pass number, stamped only once
  // picking fully completes. wmsBlocked fires much earlier: 15 minutes after
  // the picklist is CREATED (whether or not a picker has been assigned yet),
  // signaling the stock is now reserved in WMS, before anyone has physically
  // picked it. It never blocks picking itself — see anyOpen() in store.ts,
  // which is the only thing it changes (lets the hourly inventory sync
  // resume once WMS — not our own picking — is what's holding the stock).
  // Auto-set by a client-side timer (see WMS_BLOCK_DELAY_MS and
  // dueForWmsBlock in store.ts); Admin/Super Admin can revoke it, which
  // stays revoked until the picklist is reassigned to a picker — since
  // creation time never changes, a reassignment after a revoke re-arms it
  // and it fires again on the very next sweep rather than a fresh 15-min wait.
  wmsBlocked?: boolean;
  wmsBlockedAt?: string;
  wmsRevokedAt?: string;
  wmsRevokedBy?: string;
}

export type Role = "super_admin" | "admin" | "planner" | "picker";

/** Demand that could not be met at any facility. */
export interface Shortfall {
  sku: string;
  name: string;
  qty: number;
}

/** A demand upload from the planner — the top-level unit the warehouse acts on. */
export interface PickingTask {
  no: string; // PT-260722-001 — internal ID, kept for FEFO/reservation bookkeeping
  // Legacy field: before gate passes moved to being per-facility (see
  // FacilityPicklist.gatePassNo), one task carried a single gate pass number
  // shared by every facility it drew from. Still set for backward-compat
  // display on tasks created before this change — new tasks leave it
  // undefined and rely entirely on each facility's own gatePassNo instead.
  gatePassNo?: string;
  channel: string;
  demand: DemandLine[];
  facilities: FacilityPicklist[]; // in priority order, only those with lines
  shortfall: Shortfall[];
  createdAt: string;
  createdByName?: string; // display name of the planner who generated it
  archived?: boolean; // moved out of every operational view/report and out of FEFO reservation, without deleting the record
  // Bin+batch lots that were otherwise FEFO-eligible (right SKU, right shelf
  // life) but skipped for THIS task's channel because their available qty
  // fell under that channel's minBinQty floor (see ChannelRule). Recorded at
  // generate() time and appended to again if a round-2 not-found re-offer
  // also skips lots — never mutated afterward, purely a record for the Bin
  // Skip Report so Inventory can act on stock the engine passed over.
  binSkips?: BinSkip[];
}

export interface ChannelRule {
  type: "fixed" | "pct";
  val: number; // fixed = months; pct = fraction of total shelf life
  // Minimum available qty a bin+batch must have to be offered to this
  // channel at all — e.g. Internal Stock Transfer - Warehouse - 3PL only
  // wants full case-pack quantities, not loose/broken-bin remainders.
  // undefined (or 0) means no floor — every FEFO-eligible lot is offered
  // regardless of quantity, same as every other channel today.
  minBinQty?: number;
}

/** A bin+batch lot skipped for a channel's minBinQty floor — see PickingTask.binSkips. */
export interface BinSkip {
  sku: string;
  name: string;
  facility: string;
  bin: string;
  batch: string;
  qtyAvailable: number;
  threshold: number;
}

/** A SKU+Facility+Bin+Batch combination excluded from allocation until released. */
export interface Hold {
  id: number;
  sku: string;
  facility: string;
  bin: string;
  batch: string;
  qty: number; // not-found quantity that triggered the hold
  heldAt: string;
  heldBy: string;
  reason?: string;
  sourceTaskNo?: string;
  releasedAt?: string;
  releasedBy?: string;
}

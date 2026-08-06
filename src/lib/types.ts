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
  gatePassNo: string; // externally supplied gate pass document number, captured at demand upload
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
  pickedTotal?: number;
  lines: PickLine[];
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
  gatePassNo: string; // externally supplied gate pass number — the customer-facing label
  channel: string;
  demand: DemandLine[];
  facilities: FacilityPicklist[]; // in priority order, only those with lines
  shortfall: Shortfall[];
  createdAt: string;
  createdByName?: string; // display name of the planner who generated it
}

export interface ChannelRule {
  type: "fixed" | "pct";
  val: number; // fixed = months; pct = fraction of total shelf life
}

// Domain types for the FEFO Smart Picking engine.

/** Expiry as [year, month] where month is 1-12. */
export type Expiry = [number, number];

export interface StockRow {
  rid: number;
  location: string;
  bin: string;
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
  sku: string;
  qty: number;
}

export interface PickLine {
  rid?: number;
  sku: string;
  name: string;
  bin: string;
  batch?: string;
  exp?: Expiry;
  rem?: number; // remaining months at pick time
  qty: number; // suggested pick qty
  noElig?: boolean; // no eligible stock for this SKU
  shortLine?: boolean; // demand not fully coverable
  nf?: number; // not-found qty entered on completion
  picked?: number; // actual picked (qty - nf)
}

export type PicklistStatus = "open" | "completed";

export interface MasterPicklist {
  no: string;
  channel: string;
  location: string;
  status: PicklistStatus;
  bad: number; // qty moved to bad location
  gp?: string; // gatepass number
  pickedTotal?: number;
  demand: DemandLine[];
  lines: PickLine[];
}

export interface ChannelRule {
  type: "fixed" | "pct";
  val: number; // fixed = months; pct = fraction of total shelf life
}

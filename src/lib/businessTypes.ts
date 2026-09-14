// Business Type mapping — a broader rollup of ~85 real channels, supplied by
// Vipul (see docs/superpowers/specs/2026-09-14-business-type-mapping.csv for
// the source data). Deliberately SEPARATE from CHANNEL_BUCKETS in
// channels.ts, which only covers ~30 channels and drives picklist-numbering
// prefixes (REPL-/B2BE-/B2BO-/GEN-). This mapping is filter-only: it does
// NOT replace CHANNEL_BUCKETS and does NOT change task numbering — see the
// 14 Sep 2026 design spec for why that was explicitly decided.
//
// Known gap (also noted in the spec): this table doesn't obviously cover
// every channel seen live in the app — e.g. a plain "Internal Stock
// Transfer - Warehouse" (distinct from the "-3PL"/"-Local" variants) and
// "Internal Stock Transfer - NCR" were observed live but aren't in the
// supplied table. Any channel not in this map reads as BUSINESS_TYPE_UNMAPPED
// rather than silently disappearing from the filter.
export const BUSINESS_TYPE_UNMAPPED = "Other / Unmapped";

export const BUSINESS_TYPE_BY_CHANNEL: Record<string, string> = {
  "Internal Stock Transfer - Warehouse - 3PL": "Internal Stock Transfer - Warehouse - 3PL",
  "Internal Stock Transfer - Warehouse - Local": "Internal Stock Transfer - Warehouse - Local",
  "Internal Stock Transfer - Dark Stores": "Internal Stock Transfer - Dark Stores",
  "STN - MM": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - BW": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - LJ": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - MP": "Internal Stock Transfer - Warehouse - 3PL",
  "STN - Lucknow": "Internal Stock Transfer - Warehouse - 3PL",
  Amazon: "B2B Ecommerce + Q- Commerce",
  Flipkart: "B2B Ecommerce + Q- Commerce",
  "FK Hub": "B2B Ecommerce + Q- Commerce",
  Pillbox: "B2B Ecommerce + Q- Commerce",
  "RK World": "B2B Ecommerce + Q- Commerce",
  Myntra: "B2B Ecommerce + Q- Commerce",
  Nykaa: "B2B Ecommerce + Q- Commerce",
  Purplle: "B2B Ecommerce + Q- Commerce",
  Blinkit: "B2B Ecommerce + Q- Commerce",
  Zepto: "B2B Ecommerce + Q- Commerce",
  Instamart: "B2B Ecommerce + Q- Commerce",
  "Amazon Now": "B2B Ecommerce + Q- Commerce",
  Apollo: "B2B MT+ GT",
  "TATA 1MG": "B2B MT+ GT",
  "Wellness Forever": "B2B MT+ GT",
  "Health & Glow": "B2B MT+ GT",
  "Reliance Retail": "B2B MT+ GT",
  "BW Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Kolkata": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Beyond NCR": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Beyond LUC": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Beyond LUC": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Beyond LUC": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Lucknow": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "MP Ahmedabad": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Emiza Guwahati": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Emiza Guwahati": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Emiza Guwahati": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Indore": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Indore": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Indore": "Internal Stock Transfer - Warehouse - 3PL",
  "BW Emiza BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ Emiza BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "MM Emiza BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "MP BLR": "Internal Stock Transfer - Warehouse - 3PL",
  "BW HYD New": "Internal Stock Transfer - Warehouse - 3PL",
  "LJ HYD New": "Internal Stock Transfer - Warehouse - 3PL",
  "MM HYD New": "Internal Stock Transfer - Warehouse - 3PL",
  "MP HYD": "Internal Stock Transfer - Warehouse - 3PL",
  "B2B AHM Offline": "Internal Stock Transfer - Warehouse - 3PL",
  "B2B KOL Offline": "Internal Stock Transfer - Warehouse - 3PL",
  "B2B NCR Offline": "Internal Stock Transfer - Warehouse - 3PL",
  "BLR B2B Offline": "Internal Stock Transfer - Warehouse - 3PL",
  TIRA: "B2B Ecommerce + Q- Commerce",
  "First club": "B2B Ecommerce + Q- Commerce",
  "STN DS": "Internal Stock Transfer - Dark Stores",
  "SL BW": "Internal Stock Transfer - Warehouse - Local",
  "SL MM": "Internal Stock Transfer - Warehouse - Local",
  "SL LJ": "Internal Stock Transfer - Warehouse - Local",
  Delhivery_Vadaplani: "Internal Stock Transfer - Dark Stores",
  DS_AHD: "Internal Stock Transfer - Dark Stores",
  DS_BLR: "Internal Stock Transfer - Dark Stores",
  DS_Hyd: "Internal Stock Transfer - Dark Stores",
  DS_Kol: "Internal Stock Transfer - Dark Stores",
  DTDC_Ernakulum: "Internal Stock Transfer - Dark Stores",
  ER_Jaipur: "Internal Stock Transfer - Dark Stores",
  Inamo_Chembur: "Internal Stock Transfer - Dark Stores",
  Inamo_MiraRoad: "Internal Stock Transfer - Dark Stores",
  Inamo_Sion: "Internal Stock Transfer - Dark Stores",
  MH_ER_BOM: "Internal Stock Transfer - Dark Stores",
  MH_PND_DELHI: "Internal Stock Transfer - Dark Stores",
  ER_Chennai: "Internal Stock Transfer - Dark Stores",
};

/** A channel not in the mapping reads as BUSINESS_TYPE_UNMAPPED rather than silently disappearing from the filter. */
export function businessTypeOf(channel: string): string {
  return BUSINESS_TYPE_BY_CHANNEL[channel] ?? BUSINESS_TYPE_UNMAPPED;
}

export const BUSINESS_TYPES: string[] = [
  "Internal Stock Transfer - Warehouse - 3PL",
  "Internal Stock Transfer - Warehouse - Local",
  "Internal Stock Transfer - Dark Stores",
  "B2B Ecommerce + Q- Commerce",
  "B2B MT+ GT",
  BUSINESS_TYPE_UNMAPPED,
];

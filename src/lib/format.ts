import type { Expiry } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monLabel(exp?: Expiry): string {
  if (!exp) return "";
  return `${MONTHS[exp[1] - 1]} ${exp[0]}`;
}

/** The original facility picklist number an alternate (round 2+) picklist was raised for. */
export function primaryFacilityNo(no: string): string {
  return no.replace(/-R\d+$/, "");
}

export function downloadCsv(text: string, name: string): void {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

/** "180 cases + 20 eaches" style label for a case-split line; undefined for a plain line (caller falls back to the flat qty). Deliberately phrased as quantities, not a case COUNT, since PickLine only carries the resulting caseQty/eachQty, not the case size itself. */
export function caseEachLabel(l: { caseQty?: number; eachQty?: number }): string | undefined {
  if (!l.caseQty && !l.eachQty) return undefined;
  const parts: string[] = [];
  if (l.caseQty) parts.push(`${l.caseQty} case${l.caseQty === 1 ? "" : "s"}`);
  if (l.eachQty) parts.push(`${l.eachQty} each${l.eachQty === 1 ? "" : "es"}`);
  return parts.join(" + ");
}

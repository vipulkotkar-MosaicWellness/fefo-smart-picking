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

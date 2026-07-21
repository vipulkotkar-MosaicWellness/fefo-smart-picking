import type { Expiry } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monLabel(exp?: Expiry): string {
  if (!exp) return "";
  return `${MONTHS[exp[1] - 1]} ${exp[0]}`;
}

export function downloadCsv(text: string, name: string): void {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

/**
 * Does a timestamp fall before/after a chosen cutoff *date* (e.g. "2026-08-07"
 * from a <input type="date">)? "before" excludes the cutoff day itself;
 * "after" includes it — picking a date and archiving "after" it should
 * archive that day forward, not skip it.
 */
export function matchesCutoff(iso: string, cutoffDate: string, direction: "before" | "after"): boolean {
  const cutoff = new Date(cutoffDate).getTime();
  const t = new Date(iso).getTime();
  return direction === "before" ? t < cutoff : t >= cutoff;
}

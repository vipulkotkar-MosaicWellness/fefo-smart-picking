export type RangePreset = "today" | "yesterday" | "last30";

export const RANGE_LABEL: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last30: "Last 30 days",
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** [start, end) window for a preset, relative to `now`. */
export function rangeFor(preset: RangePreset, now: Date): { start: Date; end: Date } {
  const today = startOfDay(now);
  switch (preset) {
    case "today":
      return { start: today, end: now };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { start: y, end: today };
    }
    case "last30": {
      const s = new Date(today);
      s.setDate(s.getDate() - 30);
      return { start: s, end: now };
    }
  }
}

export function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

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

export type Bucket = RangePreset | "older";

export const BUCKET_LABEL: Record<Bucket, string> = {
  ...RANGE_LABEL,
  older: "Above 30 days",
};

/**
 * Mutually exclusive bucket for a timestamp — unlike rangeFor's windows
 * (which overlap: "last30" includes today), each timestamp lands in
 * exactly one bucket here, so a repository view built from these never
 * lists the same picklist twice.
 */
export function bucketFor(iso: string, now: Date): Bucket {
  const today = rangeFor("today", now);
  const yesterday = rangeFor("yesterday", now);
  const last30 = rangeFor("last30", now);
  const t = new Date(iso).getTime();
  if (t >= today.start.getTime()) return "today";
  if (t >= yesterday.start.getTime()) return "yesterday";
  if (t >= last30.start.getTime()) return "last30";
  return "older";
}

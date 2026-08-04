export type RangePreset = "today" | "yesterday" | "last7" | "last30";

export const RANGE_LABEL: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
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
    case "last7": {
      const s = new Date(today);
      s.setDate(s.getDate() - 7);
      return { start: s, end: now };
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

export type AgeingPreset = "today" | "yesterday" | "last7" | "last30" | "custom";

export const AGEING_PRESET_LABEL: Record<AgeingPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  custom: "Custom range",
};

export interface AgeingRange {
  start: Date;
  end: Date; // exclusive
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** [start, end) window for a preset, relative to `now`. `custom` needs a {from, to} pair (plain "YYYY-MM-DD" dates). */
export function ageingRangeFor(preset: AgeingPreset, now: Date, custom?: { from: string; to: string }): AgeingRange {
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
    case "custom": {
      if (!custom) return { start: today, end: now };
      const start = new Date(custom.from);
      const end = new Date(custom.to);
      end.setDate(end.getDate() + 1); // "to" day is inclusive
      return { start, end };
    }
  }
}

export function inAgeingRange(iso: string, range: AgeingRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

/** Whole days elapsed since `iso` — never negative, even for a clock-skewed future timestamp. */
export function ageDays(iso: string, now: Date): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

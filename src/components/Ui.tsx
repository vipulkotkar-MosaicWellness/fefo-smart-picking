import type { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300">
        {title}
      </h2>
      {children}
    </section>
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "muted";
const toneCls: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  bad: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  muted: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneCls[tone]}`}>
      {children}
    </span>
  );
}

type BtnVariant = "primary" | "green" | "ghost" | "sm";
const btnCls: Record<BtnVariant, string> = {
  primary: "bg-teal-700 text-white hover:bg-teal-800",
  green: "bg-emerald-700 text-white hover:bg-emerald-800",
  ghost: "border border-teal-700 bg-transparent text-teal-800 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-slate-700",
  sm: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600",
};

export type StatTone = "ok" | "warn" | "bad" | "info";
const STAT_TONE_TEXT: Record<StatTone, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-rose-700 dark:text-rose-400",
  info: "text-[var(--fefo-teal-700)] dark:text-teal-300",
};
const STAT_TONE_BADGE: Record<StatTone, string> = {
  ok: "bg-emerald-100 dark:bg-emerald-900/40",
  warn: "bg-amber-100 dark:bg-amber-900/40",
  bad: "bg-rose-100 dark:bg-rose-900/40",
  info: "bg-[var(--fefo-teal-50)] dark:bg-slate-700",
};
const STAT_TONE_RING: Record<StatTone, string> = {
  ok: "ring-2 ring-emerald-300 dark:ring-emerald-700",
  warn: "ring-2 ring-amber-300 dark:ring-amber-700",
  bad: "ring-2 ring-rose-300 dark:ring-rose-700",
  info: "ring-2 ring-teal-300 dark:ring-teal-700",
};

/**
 * The app's one KPI-card shape (icon badge + label + big number + sub-line)
 * — shared so every screen's headline stats read as one system.
 * `highlight` adds a colour-matched ring — reserve it for the one card on a
 * row that genuinely needs a second look, not every card.
 */
export function StatCard({ icon, tone, label, value, sub, highlight }: { icon: string; tone: StatTone; label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-[var(--fefo-line)] bg-white p-3.5 dark:border-slate-700 dark:bg-slate-800 ${highlight ? STAT_TONE_RING[tone] : ""}`}>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold ${STAT_TONE_BADGE[tone]} ${STAT_TONE_TEXT[tone]}`}>
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-[var(--fefo-muted)] dark:text-slate-400">{label}</p>
        <p className={`mt-0.5 text-4xl font-bold tabular-nums ${STAT_TONE_TEXT[tone]}`}>{value}</p>
        {sub && <p className="text-sm text-[var(--fefo-muted)] dark:text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

export function Button({
  variant = "primary",
  onClick,
  children,
  disabled,
}: {
  variant?: BtnVariant;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const size = variant === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-2 text-xs";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`cursor-pointer rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${size} ${btnCls[variant]}`}
    >
      {children}
    </button>
  );
}

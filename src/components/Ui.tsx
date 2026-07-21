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

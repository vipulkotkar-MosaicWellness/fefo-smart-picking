import type { ReactNode } from "react";
import { MosaicLogo } from "./brand/MosaicLogo";
import type { NavItem, ViewId } from "../lib/navigation";
import { BellIcon, GearIcon } from "./icons";

const SECTION_LABEL: Record<NavItem["section"], string> = {
  workflow: "Workflow",
  shared: "Shared",
  settings: "Settings",
};

function groupBySection(items: NavItem[]): [NavItem["section"], NavItem[]][] {
  const order: NavItem["section"][] = ["workflow", "shared", "settings"];
  return order
    .map((section): [NavItem["section"], NavItem[]] => [section, items.filter((i) => i.section === section)])
    .filter(([, group]) => group.length > 0);
}

function SidebarButton({
  item,
  active,
  badge,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        active ? "bg-[var(--fefo-teal-700)] text-white" : "text-teal-100/90 hover:bg-white/10"
      }`}
    >
      <span className="w-4 text-center" aria-hidden>
        {item.icon}
      </span>
      <span className="flex-1">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-bold">{badge}</span>
      )}
    </button>
  );
}

export function AppShell({
  navItems,
  activeView,
  onNavigate,
  breadcrumb,
  headerActions,
  badges,
  children,
}: {
  navItems: NavItem[];
  activeView: ViewId;
  onNavigate: (id: ViewId) => void;
  breadcrumb: string;
  headerActions: ReactNode;
  badges?: Partial<Record<ViewId, number>>;
  children: ReactNode;
}) {
  const sections = groupBySection(navItems);
  const settingsItems = navItems.filter((i) => i.section === "settings");
  const primarySections = sections.filter(([section]) => section !== "settings");

  return (
    <div className="min-h-screen bg-[var(--fefo-bg)] text-[var(--fefo-text)] dark:bg-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-[var(--fefo-line)] bg-white px-4 dark:border-slate-700 dark:bg-slate-800 md:px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <MosaicLogo compact />
          <span className="text-sm font-extrabold tracking-tight">FEFO Operations</span>
        </div>
        <div className="hidden items-center gap-2 text-xs text-[var(--fefo-muted)] dark:text-slate-400 md:flex">
          <span aria-hidden>/</span>
          <b className="font-semibold text-[var(--fefo-text)] dark:text-slate-100">{breadcrumb}</b>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {navItems.some((i) => i.id === "supervisor") && (
            <button
              onClick={() => onNavigate("supervisor")}
              aria-label="Picking queue notifications"
              title="Open picklists awaiting assignment"
              className="relative rounded-full border border-[var(--fefo-line)] bg-slate-50 p-2 text-[var(--fefo-teal-700)] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-teal-300 dark:hover:bg-slate-600"
            >
              <BellIcon className="h-5 w-5" />
              {badges?.supervisor != null && badges.supervisor > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-800">
                  {badges.supervisor}
                </span>
              )}
            </button>
          )}
          {navItems.some((i) => i.id === "admin") && (
            <button
              onClick={() => onNavigate("admin")}
              aria-label="Admin settings"
              title="Admin settings"
              className="rounded-full border border-[var(--fefo-line)] bg-slate-50 p-2 text-[var(--fefo-teal-700)] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-teal-300 dark:hover:bg-slate-600"
            >
              <GearIcon className="h-5 w-5" />
            </button>
          )}
          {headerActions}
        </div>
      </header>

      <div className="flex">
        <nav
          aria-label="Main"
          className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto bg-[var(--fefo-teal-950)] px-3 py-4 md:block"
        >
          <div className="space-y-5">
            {primarySections.map(([section, items]) => (
              <div key={section}>
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-teal-300/70">
                  {SECTION_LABEL[section]}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <SidebarButton
                      key={item.id}
                      item={item}
                      active={activeView === item.id}
                      badge={badges?.[item.id]}
                      onClick={() => onNavigate(item.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {settingsItems.length > 0 && (
            <div className="absolute inset-x-3 bottom-4 border-t border-white/10 pt-3.5">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-widest text-teal-300/70">
                {SECTION_LABEL.settings}
              </p>
              {settingsItems.map((item) => (
                <SidebarButton
                  key={item.id}
                  item={item}
                  active={activeView === item.id}
                  badge={badges?.[item.id]}
                  onClick={() => onNavigate(item.id)}
                />
              ))}
            </div>
          )}
        </nav>

        <main className="min-w-0 flex-1 space-y-4 px-4 py-6 pb-24 md:px-7 md:pb-6">{children}</main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-flow-col border-t border-white/10 bg-[var(--fefo-teal-950)] shadow-[0_-2px_10px_rgba(0,0,0,0.15)] md:hidden"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold ${
              activeView === item.id ? "bg-[var(--fefo-teal-700)] text-white" : "text-teal-100/80"
            }`}
          >
            <span aria-hidden>{item.icon}</span>
            <span>{item.label}</span>
            {badges?.[item.id] != null && badges[item.id]! > 0 && (
              <span className="absolute right-3 top-1 rounded-full bg-white/20 px-1 text-[9px] font-bold">
                {badges[item.id]}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

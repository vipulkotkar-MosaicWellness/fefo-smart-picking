import type { ReactNode } from "react";
import { MosaicLogo } from "./brand/MosaicLogo";
import type { NavItem, ViewId } from "../lib/navigation";

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

export function AppShell({
  navItems,
  activeView,
  onNavigate,
  breadcrumb,
  headerActions,
  children,
}: {
  navItems: NavItem[];
  activeView: ViewId;
  onNavigate: (id: ViewId) => void;
  breadcrumb: string;
  headerActions: ReactNode;
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
        <div className="ml-auto flex items-center gap-2.5">{headerActions}</div>
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
                    <button
                      key={item.id}
                      onClick={() => onNavigate(item.id)}
                      aria-current={activeView === item.id ? "page" : undefined}
                      className={`w-full rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                        activeView === item.id ? "bg-[var(--fefo-teal-700)] text-white" : "text-teal-100/90 hover:bg-white/10"
                      }`}
                    >
                      {item.label}
                    </button>
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
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  aria-current={activeView === item.id ? "page" : undefined}
                  className={`w-full rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    activeView === item.id ? "bg-[var(--fefo-teal-700)] text-white" : "text-teal-100/90 hover:bg-white/10"
                  }`}
                >
                  {item.label}
                </button>
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
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold ${
              activeView === item.id ? "bg-[var(--fefo-teal-700)] text-white" : "text-teal-100/80"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

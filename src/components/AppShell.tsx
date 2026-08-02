import type { ReactNode } from "react";
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
  children,
}: {
  navItems: NavItem[];
  activeView: ViewId;
  onNavigate: (id: ViewId) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 md:flex-row">
      <nav aria-label="Main" className="hidden shrink-0 md:block md:w-52">
        <div className="sticky top-4 space-y-4">
          {groupBySection(navItems).map(([section, items]) => (
            <div key={section}>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {SECTION_LABEL[section]}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    aria-current={activeView === item.id ? "page" : undefined}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                      activeView === item.id
                        ? "bg-teal-700 text-white"
                        : "text-slate-700 hover:bg-teal-50 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <main className="min-w-0 flex-1 space-y-4 pb-16 md:pb-0">{children}</main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white shadow-[0_-1px_4px_rgba(0,0,0,0.06)] md:hidden dark:border-slate-700 dark:bg-slate-900"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            aria-current={activeView === item.id ? "page" : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold ${
              activeView === item.id ? "text-teal-700 dark:text-teal-300" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

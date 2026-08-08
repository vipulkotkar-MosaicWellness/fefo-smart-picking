import type { Role } from "./types";

export type ViewId = "demand" | "supervisor" | "picker" | "inventory" | "reports" | "admin";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  section: "workflow" | "shared" | "settings";
}

const ALL_ITEMS: (NavItem & { roles: Role[] })[] = [
  { id: "demand", label: "Demand Planner", icon: "⇧", section: "workflow", roles: ["planner", "admin", "super_admin"] },
  { id: "supervisor", label: "Picking Supervisor", icon: "▦", section: "workflow", roles: ["planner", "admin", "super_admin"] },
  { id: "reports", label: "Reports", icon: "↗", section: "workflow", roles: ["planner", "admin", "super_admin"] },
  { id: "picker", label: "Picker", icon: "▣", section: "workflow", roles: ["picker"] },
  { id: "inventory", label: "Inventory", icon: "⌕", section: "shared", roles: ["planner", "admin", "super_admin"] },
  { id: "admin", label: "Admin", icon: "⚙", section: "settings", roles: ["admin", "super_admin"] },
];

/** Nav items a given role may see, in the app's canonical order. */
export function getNavigation(role: Role): NavItem[] {
  return ALL_ITEMS.filter((item) => item.roles.includes(role)).map(({ roles: _roles, ...item }) => item);
}

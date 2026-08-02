import type { Role } from "./types";

export type ViewId = "demand" | "supervisor" | "picker" | "inventory" | "admin";

export interface NavItem {
  id: ViewId;
  label: string;
  section: "workflow" | "shared" | "settings";
}

const ALL_ITEMS: (NavItem & { roles: Role[] })[] = [
  { id: "demand", label: "Demand Planner", section: "workflow", roles: ["planner", "admin", "super_admin"] },
  { id: "supervisor", label: "Picking Supervisor", section: "workflow", roles: ["planner", "admin", "super_admin"] },
  { id: "picker", label: "Picker", section: "workflow", roles: ["picker"] },
  { id: "inventory", label: "Inventory", section: "shared", roles: ["planner", "admin", "super_admin"] },
  { id: "admin", label: "Admin", section: "settings", roles: ["admin", "super_admin"] },
];

/** Nav items a given role may see, in the app's canonical order. */
export function getNavigation(role: Role): NavItem[] {
  return ALL_ITEMS.filter((item) => item.roles.includes(role)).map(({ roles: _roles, ...item }) => item);
}

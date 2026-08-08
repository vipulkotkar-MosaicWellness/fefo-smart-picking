import { describe, expect, it } from "vitest";
import { getNavigation } from "../../src/lib/navigation";

describe("getNavigation", () => {
  it("orders items for an admin-tier account, with Admin under Settings", () => {
    expect(getNavigation("admin").map((item) => item.label)).toEqual([
      "Demand Planner",
      "Picking Supervisor",
      "Reports",
      "Inventory",
      "Admin",
    ]);
  });

  it("gives super_admin the same workflow access as admin", () => {
    expect(getNavigation("super_admin").map((item) => item.label)).toEqual([
      "Demand Planner",
      "Picking Supervisor",
      "Reports",
      "Inventory",
      "Admin",
    ]);
  });

  it("only gives Picker their own workflow", () => {
    expect(getNavigation("picker").map((item) => item.label)).toEqual(["Picker"]);
  });

  it("never shows Admin to the planner role", () => {
    expect(getNavigation("planner").map((item) => item.label)).not.toContain("Admin");
  });
});

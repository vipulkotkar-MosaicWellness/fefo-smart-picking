import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FacilityBlock } from "../../src/components/FacilityBlock";
import type { FacilityPicklist } from "../../src/lib/types";

function facility(overrides: Partial<FacilityPicklist> = {}): FacilityPicklist {
  return {
    no: "TASK-DISP-MH", taskNo: "TASK-DISP", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
    lines: [],
    ...overrides,
  };
}

describe("FacilityBlock — case+each display", () => {
  it("shows a case/each breakdown when the line has one", () => {
    const f = facility({
      lines: [{ rid: 1, sku: "SKU-CS", name: "Product CS", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200, caseQty: 180, eachQty: 20 }],
    });
    render(<FacilityBlock f={f} />);
    expect(screen.getByText(/180 cases/)).toBeInTheDocument();
    expect(screen.getByText(/20 eaches/)).toBeInTheDocument();
  });

  it("a line with no case size shows the plain quantity, unchanged", () => {
    const f = facility({
      lines: [{ rid: 1, sku: "SKU-PLAIN", name: "Product Plain", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200 }],
    });
    render(<FacilityBlock f={f} />);
    expect(screen.queryByText(/cases/)).not.toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("a line that is ALL cases (no loose remainder) shows only the case quantity, not '0 eaches'", () => {
    const f = facility({
      lines: [{ rid: 1, sku: "SKU-ALLCASE", name: "Product AllCase", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 300, caseQty: 300 }],
    });
    render(<FacilityBlock f={f} />);
    expect(screen.getByText(/300 cases/)).toBeInTheDocument();
    expect(screen.queryByText(/eaches/)).not.toBeInTheDocument();
  });

  it("a completed/picked line shows the picked total, not a case/each label", () => {
    const f = facility({
      status: "completed",
      lines: [{ rid: 1, sku: "SKU-CS", name: "Product CS", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 900, qty: 200, caseQty: 180, eachQty: 20, picked: 195 }],
    });
    render(<FacilityBlock f={f} />);
    expect(screen.queryByText(/cases/)).not.toBeInTheDocument();
    expect(screen.getByText("195")).toBeInTheDocument();
  });
});

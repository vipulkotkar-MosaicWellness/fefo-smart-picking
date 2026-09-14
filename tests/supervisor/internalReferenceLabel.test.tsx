import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FacilityBlock } from "../../src/components/FacilityBlock";
import type { FacilityPicklist } from "../../src/lib/types";

function completedFacility(): FacilityPicklist {
  return {
    no: "TASK-1-MH", taskNo: "TASK-1", facility: "SL Mother Hub", status: "completed", round: 1, bad: 0,
    gp: "GP-133702", pickedTotal: 10, gatePassNo: "GPSLMH-REAL01",
    lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 10, picked: 10 }],
  };
}

describe("FacilityBlock — internal reference number", () => {
  it("labels the internal gp code as 'Internal ref:', not a bare 'Gatepass'", () => {
    render(<FacilityBlock f={completedFacility()} gatePassNo="GPSLMH-REAL01" />);
    expect(screen.getByText(/Internal ref:/)).toBeInTheDocument();
    expect(screen.getByText(/GP-133702/)).toBeInTheDocument();
  });
});

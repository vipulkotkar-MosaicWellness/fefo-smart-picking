import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminConfig } from "../../src/components/AdminConfig";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();
afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
});

function taskDemanding(sku: string, qty: number): PickingTask {
  return {
    no: `TASK-${sku}`, channel: "Blinkit", demand: [{ channel: "Blinkit", sku, qty, gatePassNo: undefined }],
    facilities: [], shortfall: [], createdAt: new Date().toISOString(),
  };
}

describe("AdminConfig — case size gap dashboard", () => {
  it("shows headline counts and a volume-ranked gap table", () => {
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "super_admin" } });
    useStore.setState({
      caseSizes: { "SKU-COVERED": 30 },
      caseSizeGaps: [
        { sku: "SKU-BIG-GAP", first_seen_at: "2026-09-01T00:00:00.000Z", last_seen_at: "2026-09-15T00:00:00.000Z", occurrences: 5, total_qty: 900 },
        { sku: "SKU-SMALL-GAP", first_seen_at: "2026-09-10T00:00:00.000Z", last_seen_at: "2026-09-11T00:00:00.000Z", occurrences: 1, total_qty: 20 },
      ],
      skus: {
        "SKU-COVERED": { name: "Covered Product", shelf: 24 },
        "SKU-BIG-GAP": { name: "Big Gap Product", shelf: 24 },
        "SKU-SMALL-GAP": { name: "Small Gap Product", shelf: 24 },
      },
      tasks: [taskDemanding("SKU-COVERED", 100), taskDemanding("SKU-BIG-GAP", 900), taskDemanding("SKU-SMALL-GAP", 20)],
    });

    render(<AdminConfig />);

    expect(screen.getByText(/1 SKU served with case-based picking/i)).toBeInTheDocument();
    expect(screen.getByText(/2 SKUs affected by a missing case size/i)).toBeInTheDocument();

    // Ranked by volume — the 900-unit gap must appear before the 20-unit one.
    const rows = screen.getAllByTestId("case-size-gap-row");
    expect(rows[0]).toHaveTextContent("SKU-BIG-GAP");
    expect(rows[0]).toHaveTextContent("900");
    expect(rows[1]).toHaveTextContent("SKU-SMALL-GAP");
    expect(rows[1]).toHaveTextContent("20");
  });

  it("a SKU with historical gap entries but now covered by a case size shows as resolved, not as an open gap", () => {
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "super_admin" } });
    useStore.setState({
      caseSizes: { "SKU-NOW-FIXED": 40 },
      caseSizeGaps: [{ sku: "SKU-NOW-FIXED", first_seen_at: "2026-09-01T00:00:00.000Z", last_seen_at: "2026-09-05T00:00:00.000Z", occurrences: 3, total_qty: 300 }],
      skus: { "SKU-NOW-FIXED": { name: "Now Fixed Product", shelf: 24 } },
      tasks: [taskDemanding("SKU-NOW-FIXED", 300)],
    });

    render(<AdminConfig />);

    expect(screen.getByText(/1 SKU served with case-based picking/i)).toBeInTheDocument();
    expect(screen.getByText(/0 SKUs affected by a missing case size/i)).toBeInTheDocument();
    const row = screen.getByTestId("case-size-gap-row-resolved");
    expect(row).toHaveTextContent("SKU-NOW-FIXED");
    expect(row).toHaveTextContent(/resolved/i);
  });
});

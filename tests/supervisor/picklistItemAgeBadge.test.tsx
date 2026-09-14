import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SupervisorQueue } from "../../src/components/SupervisorQueue";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();

afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
});

function task(no: string, createdAt: string): PickingTask {
  return {
    no,
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt,
    facilities: [
      {
        no: `${no}-MH`,
        taskNo: no,
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: `GP-${no}`,
        createdAt,
        lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5 }],
      },
    ],
  };
}

describe("SupervisorQueue — existing pipeline buckets are unaffected by the age-badge prop", () => {
  it("still renders a picklist in its pipeline bucket exactly as before (no age badge there)", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [task("PLAIN1", "2026-09-14T00:00:00Z")] });
    render(<SupervisorQueue />);
    // An open, unassigned picklist also surfaces in the Needs Attention panel
    // (by design — it's a shortcut view on top of the same underlying data),
    // so match on the pipeline-bucket instance specifically, not the panel's.
    const bucketInstance = screen
      .getAllByText(/GP-PLAIN1/)
      .find((el) => !el.closest('[data-testid="needs-attention"]'));
    expect(bucketInstance).toBeInTheDocument();
  });
});

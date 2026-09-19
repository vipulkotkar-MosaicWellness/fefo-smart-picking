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

// The queue's own item list (supervisorVisibleFacilityLists) drops discarded
// picklists AND anything still in Gate Pass Allocation Pending. The round
// tabs were built from the raw `tasks` instead, so those same excluded rounds
// came back as clickable tabs on a sibling round's card — and selecting one
// rendered it through FacilityBlock with the full open-picklist control set:
// "Assign all to", per-line picker selects, not-found inputs, "Mark
// completed", and Discard. A picklist a supervisor had explicitly cancelled
// could be re-assigned and completed from the queue; a picklist deliberately
// held back until its gate pass exists could be picked without one.
function taskWithDiscardedRoundTwo(): PickingTask {
  return {
    no: "TASK-DISC",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-10T00:00:00Z",
    facilities: [
      {
        no: "TASK-DISC-MH",
        taskNo: "TASK-DISC",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH10501",
        createdAt: "2026-09-10T00:00:00Z",
        lines: [{ rid: 1, sku: "SKU-1", name: "Product 1", facility: "SL Mother Hub", bin: "A1", batch: "BA019232", exp: [2099, 1], rem: 12, qty: 5 }],
      },
      {
        no: "TASK-DISC-AMB-R2",
        taskNo: "TASK-DISC",
        facility: "SL Ambient",
        status: "open",
        round: 2,
        bad: 0,
        discarded: true,
        gatePassNo: "GPSLAMB27801",
        createdAt: "2026-09-11T00:00:00Z",
        reofferedFrom: "TASK-DISC-MH",
        lines: [{ rid: 2, sku: "SKU-1", name: "Product 1", facility: "SL Ambient", bin: "C1", batch: "BA000111", exp: [2099, 2], rem: 12, qty: 3 }],
      },
    ],
  };
}

function taskWithPendingRoundTwo(): PickingTask {
  return {
    no: "TASK-PEND",
    channel: "Flipkart",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-12T00:00:00Z",
    facilities: [
      {
        no: "TASK-PEND-MH",
        taskNo: "TASK-PEND",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH10777",
        createdAt: "2026-09-12T00:00:00Z",
        lines: [{ rid: 10, sku: "SKU-2", name: "Product 2", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 9 }],
      },
      {
        // No gatePassNo and the parent task has none either -> still in
        // "Gate Pass Allocation Pending", deliberately invisible to the queue.
        no: "TASK-PEND-AMB-R2",
        taskNo: "TASK-PEND",
        facility: "SL Ambient",
        status: "open",
        round: 2,
        bad: 0,
        createdAt: "2026-09-13T00:00:00Z",
        reofferedFrom: "TASK-PEND-MH",
        lines: [{ rid: 11, sku: "SKU-2", name: "Product 2", facility: "SL Ambient", bin: "C1", batch: "B2", exp: [2099, 2], rem: 12, qty: 2 }],
      },
    ],
  };
}

function asSupervisor() {
  useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "admin" } });
}

describe("SupervisorQueue — rounds the queue excludes are not offered as tabs", () => {
  it("does not render a tab for a discarded round", () => {
    asSupervisor();
    useStore.setState({ tasks: [taskWithDiscardedRoundTwo()] });
    render(<SupervisorQueue />);

    expect(screen.queryAllByRole("button", { name: /Round 2 · SL Ambient/ })).toHaveLength(0);
    expect(screen.queryByText(/TASK-DISC-AMB-R2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/GPSLAMB27801/)).not.toBeInTheDocument();
    // The visible round-1 card is untouched.
    expect(screen.getByText(/GPSLMH10501/)).toBeInTheDocument();
  });

  it("does not render a tab for a round still in Gate Pass Allocation Pending", () => {
    asSupervisor();
    useStore.setState({ tasks: [taskWithPendingRoundTwo()] });
    render(<SupervisorQueue />);

    expect(screen.queryAllByRole("button", { name: /Round 2 · SL Ambient/ })).toHaveLength(0);
    expect(screen.queryByText(/TASK-PEND-AMB-R2/)).not.toBeInTheDocument();
    expect(screen.getByText(/GPSLMH10777/)).toBeInTheDocument();
  });
});

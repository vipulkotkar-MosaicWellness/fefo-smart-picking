import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function taskWithHistory(): PickingTask {
  return {
    no: "TASK-HIST",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-10T00:00:00Z",
    facilities: [
      {
        no: "TASK-HIST-MH",
        taskNo: "TASK-HIST",
        facility: "SL Mother Hub",
        status: "completed",
        round: 1,
        bad: 3,
        gatePassNo: "GP-ORIGINAL",
        createdAt: "2026-09-10T00:00:00Z",
        lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 10, picked: 7, nf: 3 }],
      },
      {
        no: "TASK-HIST-AMB-R2",
        taskNo: "TASK-HIST",
        facility: "SL Ambient",
        status: "open",
        round: 2,
        bad: 0,
        gatePassNo: "GP-ROUND2",
        createdAt: "2026-09-13T00:00:00Z",
        reofferedFrom: "TASK-HIST-MH",
        lines: [{ rid: 2, sku: "SKU1", name: "Product", facility: "SL Ambient", bin: "C1", batch: "B2", exp: [2099, 2], rem: 12, qty: 3 }],
      },
    ],
  };
}

function taskWithoutHistory(): PickingTask {
  return {
    no: "TASK-PLAIN",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: "2026-09-13T00:00:00Z",
    facilities: [
      {
        no: "TASK-PLAIN-MH",
        taskNo: "TASK-PLAIN",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GP-PLAIN",
        createdAt: "2026-09-13T00:00:00Z",
        lines: [{ rid: 3, sku: "SKU2", name: "Product 2", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5 }],
      },
    ],
  };
}

function pickingPendingBucket(): HTMLElement {
  const heading = screen.getByText(/Picking Pending/);
  return heading.closest("details")!;
}

describe("SupervisorQueue — round history", () => {
  it("shows round tabs for a picklist with a multi-round family, defaulting to Original", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [taskWithHistory()] });
    render(<SupervisorQueue />);

    // The Round 2 entry (GP-ROUND2) is the one that actually sits in the
    // "Picking Pending" bucket — its card should show tabs, defaulting to
    // showing the Original's gate pass number since selectedRound defaults
    // to 1. The round-1 entry ALSO shows its own tabs, from the "Not
    // found — needs an alternate" bucket it independently belongs in
    // (completed, bad > 0) — that's a separate, valid vantage point onto
    // the same family's story, so queries here are scoped to just this
    // bucket to avoid ambiguity with that other card.
    const bucket = pickingPendingBucket();
    expect(within(bucket).getByText(/Original/)).toBeInTheDocument();
    expect(within(bucket).getByText(/Round 2/)).toBeInTheDocument();
    expect(within(bucket).getByText(/GP-ORIGINAL/)).toBeInTheDocument();
  });

  it("switches to Round 2's own gate pass number when its tab is clicked", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [taskWithHistory()] });
    render(<SupervisorQueue />);

    const bucket = pickingPendingBucket();
    await user.click(within(bucket).getByRole("button", { name: /Round 2/ }));

    expect(within(bucket).getByText(/GP-ROUND2/)).toBeInTheDocument();
  });

  it("shows no round tabs for a picklist with no re-offer history", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [taskWithoutHistory()] });
    render(<SupervisorQueue />);

    expect(screen.getByText(/GP-PLAIN/)).toBeInTheDocument();
    expect(screen.queryByText(/Original/)).not.toBeInTheDocument();
  });
});

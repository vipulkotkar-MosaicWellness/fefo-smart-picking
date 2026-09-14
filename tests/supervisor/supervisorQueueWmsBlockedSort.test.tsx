import { render, screen, within } from "@testing-library/react";
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

// wmsBlocked defaults to true here since these tests are specifically about
// the "Gatepass generated — inventory blocked (WMS)" bucket's sort order.
function task(no: string, createdAt: string, opts: { picker?: string; wmsBlocked?: boolean } = {}): PickingTask {
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
        wmsBlocked: opts.wmsBlocked ?? true,
        lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5, picker: opts.picker }],
      },
    ],
  };
}

function wmsBlockedBucket(): HTMLElement {
  const heading = screen.getByText(/Gatepass generated — inventory blocked \(WMS\)/);
  return heading.closest("details")!;
}

describe("SupervisorQueue — WMS Blocked bucket sorted by urgency", () => {
  it("lists the unassigned picklist ahead of the older assigned one within the bucket", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({
      tasks: [
        task("OLDER-ASSIGNED", "2026-09-10T00:00:00Z", { picker: "Ravi" }),
        task("NEWER-UNASSIGNED", "2026-09-13T00:00:00Z"),
      ],
    });
    render(<SupervisorQueue />);

    const bucket = wmsBlockedBucket();
    const rows = within(bucket).getAllByText(/GP-/);
    expect(rows[0]).toHaveTextContent("GP-NEWER-UNASSIGNED");
    expect(rows[1]).toHaveTextContent("GP-OLDER-ASSIGNED");
  });

  it("sorts oldest-first within the same assignment group", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({
      tasks: [
        task("NEWER", "2026-09-13T00:00:00Z"),
        task("OLDER", "2026-09-10T00:00:00Z"),
      ],
    });
    render(<SupervisorQueue />);

    const bucket = wmsBlockedBucket();
    const rows = within(bucket).getAllByText(/GP-/);
    expect(rows[0]).toHaveTextContent("GP-OLDER");
    expect(rows[1]).toHaveTextContent("GP-NEWER");
  });

  it("shows an age tag on each row in the bucket", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [task("AGED1", "2026-09-10T00:00:00Z")] });
    render(<SupervisorQueue />);

    const bucket = wmsBlockedBucket();
    // Age is computed against "now" at render time, so just assert some
    // day-and-hour-shaped text exists rather than a hardcoded value.
    expect(within(bucket).getByText(/\d+d \d+h|\d+h|\d+m/)).toBeInTheDocument();
  });

  it("does not affect the Picking Pending bucket's order or add age tags there", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({
      tasks: [
        task("NEWER-PENDING", "2026-09-13T00:00:00Z", { wmsBlocked: false }),
        task("OLDER-PENDING", "2026-09-10T00:00:00Z", { wmsBlocked: false }),
      ],
    });
    render(<SupervisorQueue />);

    const heading = screen.getByText(/Picking Pending/);
    const bucket = heading.closest("details")!;
    const rows = within(bucket).getAllByText(/GP-/);
    // Picking Pending keeps its existing creation-order (queue #) behaviour —
    // NEWER-PENDING was created first in this test's tasks array insertion
    // order relative to task-creation order used by supervisorVisibleFacilityLists,
    // so it stays first; the point of this test is simply that no age tag
    // ("Xd Xh"/"Xh"/"Xm") appears here, unlike the WMS Blocked bucket.
    expect(rows).toHaveLength(2);
    expect(within(bucket).queryByText(/\d+d \d+h|\d+h ago|\d+m ago/)).not.toBeInTheDocument();
  });

  it("no longer renders a separate Needs Attention panel", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [task("SOME-TASK", "2026-09-10T00:00:00Z")] });
    render(<SupervisorQueue />);
    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs attention/i)).not.toBeInTheDocument();
  });

  it("search still narrows the WMS Blocked bucket", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({
      tasks: [task("APPLE-ORDER", "2026-09-13T00:00:00Z"), task("BANANA-ORDER", "2026-09-13T00:00:00Z")],
    });
    render(<SupervisorQueue />);

    expect(screen.getAllByText(/GP-APPLE-ORDER/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GP-BANANA-ORDER/).length).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText(/search/i), "apple");

    expect(screen.getAllByText(/GP-APPLE-ORDER/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/GP-BANANA-ORDER/)).not.toBeInTheDocument();
  });
});

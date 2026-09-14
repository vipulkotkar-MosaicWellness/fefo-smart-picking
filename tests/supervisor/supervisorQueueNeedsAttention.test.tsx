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

function task(no: string, createdAt: string, picker?: string): PickingTask {
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
        lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5, picker }],
      },
    ],
  };
}

describe("SupervisorQueue — Needs Attention panel", () => {
  it("lists the unassigned picklist ahead of the older assigned one", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({
      tasks: [
        task("OLDER-ASSIGNED", "2026-09-10T00:00:00Z", "Ravi"),
        task("NEWER-UNASSIGNED", "2026-09-13T00:00:00Z"),
      ],
    });
    render(<SupervisorQueue />);

    const panel = screen.getByTestId("needs-attention");
    const rows = within(panel).getAllByText(/GP-/);
    expect(rows[0]).toHaveTextContent("GP-NEWER-UNASSIGNED");
    expect(rows[1]).toHaveTextContent("GP-OLDER-ASSIGNED");
  });

  it("shows an age tag for each row in the panel", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [task("AGED1", "2026-09-10T00:00:00Z")] });
    render(<SupervisorQueue />);

    const panel = screen.getByTestId("needs-attention");
    // Age is computed against "now" at render time, so just assert some
    // day-and-hour-shaped text exists rather than a hardcoded value.
    expect(within(panel).getByText(/\d+d \d+h|\d+h|\d+m/)).toBeInTheDocument();
  });

  it("does not render the panel when there are no open picklists", () => {
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [] });
    render(<SupervisorQueue />);
    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });

  it("search narrows the pipeline-stage buckets too, not just the needs-attention panel", async () => {
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

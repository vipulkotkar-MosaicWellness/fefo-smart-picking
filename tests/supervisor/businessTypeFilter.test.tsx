import { render, screen } from "@testing-library/react";
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

function task(no: string, channel: string): PickingTask {
  return {
    no,
    channel,
    demand: [],
    shortfall: [],
    createdAt: "2026-09-13T00:00:00Z",
    facilities: [
      {
        no: `${no}-MH`,
        taskNo: no,
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: `GP-${no}`,
        createdAt: "2026-09-13T00:00:00Z",
        lines: [{ rid: 1, sku: "SKU1", name: "Product", facility: "SL Mother Hub", bin: "A1", batch: "B1", exp: [2099, 1], rem: 12, qty: 5 }],
      },
    ],
  };
}

describe("SupervisorQueue — Business Type filter", () => {
  it("narrows the queue to only picklists whose channel maps to the selected business type", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "s@x.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({
      tasks: [task("AMAZON-ORDER", "Amazon"), task("STN-ORDER", "STN - MM")],
    });
    render(<SupervisorQueue />);

    expect(screen.getByText(/GP-AMAZON-ORDER/)).toBeInTheDocument();
    expect(screen.getByText(/GP-STN-ORDER/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/business type/i), "B2B Ecommerce + Q- Commerce");

    expect(screen.getByText(/GP-AMAZON-ORDER/)).toBeInTheDocument();
    expect(screen.queryByText(/GP-STN-ORDER/)).not.toBeInTheDocument();
  });
});

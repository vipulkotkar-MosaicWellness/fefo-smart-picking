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

// A queue this heavy is exactly the real-world shape that made the page
// unusable — hundreds of picklists, each with many lines (every line means
// one number input + one select mounted by FacilityBlock). Before the fix,
// all of it mounted immediately regardless of which accordion was open.
function heavyTask(no: string, lineCount: number): PickingTask {
  return {
    no,
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      {
        no: `${no}-MH`,
        taskNo: no,
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: `GP-${no}`,
        lines: Array.from({ length: lineCount }, (_, i) => ({
          rid: Number(no.replace(/\D/g, "")) * 1000 + i,
          sku: `SKU-${no}-${i}`,
          name: `Product ${no}-${i}`,
          facility: "SL Mother Hub",
          bin: `A${i}`,
          batch: "BA000111",
          exp: [2099, 1] as [number, number],
          rem: 12,
          qty: 5,
        })),
      },
    ],
  };
}

describe("SupervisorQueue — lazy-mounts each picklist's heavy detail", () => {
  it("doesn't mount a picklist's line inputs until its accordion is opened", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "sup@example.com", display_name: "Supervisor", role: "supervisor" } });
    // Two picklists — enough to prove opening one doesn't force-mount the other.
    useStore.setState({ tasks: [heavyTask("TASK1", 20), heavyTask("TASK2", 20)] });

    render(<SupervisorQueue />);

    // Before opening anything: neither picklist's line-level inputs exist yet.
    expect(screen.queryAllByRole("spinbutton").length).toBe(0);
    expect(screen.queryByText("SKU-TASK1-0")).not.toBeInTheDocument();

    // Open TASK1's accordion.
    await user.click(screen.getByText(/GP-TASK1/));

    // TASK1's lines are now mounted...
    expect(screen.getByText("SKU-TASK1-0")).toBeInTheDocument();
    expect(screen.queryAllByRole("spinbutton").length).toBe(20);
    // ...but TASK2's are still not — opening one item doesn't mount the rest.
    expect(screen.queryByText("SKU-TASK2-0")).not.toBeInTheDocument();
  });

  it("keeps a picklist's inputs mounted after the accordion is collapsed again", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "sup@example.com", display_name: "Supervisor", role: "supervisor" } });
    useStore.setState({ tasks: [heavyTask("TASK3", 5)] });

    render(<SupervisorQueue />);

    const summary = screen.getByText(/GP-TASK3/);
    await user.click(summary); // open
    expect(screen.getByText("SKU-TASK3-0")).toBeInTheDocument();

    await user.click(summary); // collapse again
    // Still in the DOM (just visually hidden by the closed <details>) — an
    // in-progress not-found entry a supervisor typed must survive this.
    expect(screen.getByText("SKU-TASK3-0")).toBeInTheDocument();
  });
});

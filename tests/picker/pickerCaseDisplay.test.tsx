import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PickerView } from "../../src/components/PickerView";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";
import type { PickingTask } from "../../src/lib/types";

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();

afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
});

function taskWithCaseSplitLine(): PickingTask {
  return {
    no: "TASK-PVCASE",
    channel: "Blinkit",
    demand: [],
    shortfall: [],
    createdAt: new Date().toISOString(),
    facilities: [
      {
        no: "TASK-PVCASE-MH",
        taskNo: "TASK-PVCASE",
        facility: "SL Mother Hub",
        status: "open",
        round: 1,
        bad: 0,
        gatePassNo: "GPSLMH11300", // must be set — PickerView only shows facilities past "Gate Pass Allocation Pending"
        lines: [
          {
            rid: 1,
            sku: "SKU-CS",
            name: "Product CS",
            facility: "SL Mother Hub",
            bin: "A1",
            batch: "BA019232",
            exp: [2099, 1],
            rem: 12,
            qty: 200,
            caseQty: 180,
            eachQty: 20,
            picker: "Ravi",
          },
        ],
      },
    ],
  };
}

function setup() {
  useAuth.setState({ profile: { id: "u1", email: "ravi@example.com", display_name: "Ravi", role: "picker" } });
  useStore.setState({ tasks: [taskWithCaseSplitLine()] });
}

describe("PickerView — case+each display", () => {
  it("shows the case+each breakdown in the Pick instruction", async () => {
    const user = userEvent.setup();
    setup();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    expect(screen.getByText(/180 cases/)).toBeInTheDocument();
    expect(screen.getByText(/20 eaches/)).toBeInTheDocument();
  });

  it("leaves the not-found stepper and Found button in plain units, unaffected by the case split", async () => {
    const user = userEvent.setup();
    setup();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    // The headline Pick instruction shows the case+each phrasing...
    expect(screen.getByText(/180 cases \+ 20 eaches/)).toBeInTheDocument();
    // ...but the Found button and not-found flow still report the flat unit qty (200).
    expect(screen.getByRole("button", { name: /Found — Picked 200/ })).toBeInTheDocument();
  });
});

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

// Two lines so a "Picked" tap on line 1 only advances locally — it never
// reaches the last-line branch that calls applyPicks() (and, through it,
// a real Supabase write), which is what we specifically want to avoid here.
const task: PickingTask = {
  no: "TEST-PK-1",
  channel: "Blinkit",
  demand: [],
  shortfall: [],
  createdAt: new Date().toISOString(),
  facilities: [
    {
      no: "TEST-PK-1-MH",
      taskNo: "TEST-PK-1",
      facility: "SL Mother Hub",
      status: "open",
      round: 1,
      bad: 0,
      lines: [
        { rid: 1, sku: "SKU-A", name: "Product A", facility: "SL Mother Hub", bin: "A1", batch: "BA019232", exp: [2099, 1], rem: 12, qty: 15, picker: "Ravi" },
        { rid: 2, sku: "SKU-B", name: "Product B", facility: "SL Mother Hub", bin: "A2", batch: "BA000111", exp: [2099, 2], rem: 12, qty: 6, picker: "Ravi" },
      ],
    },
  ],
};

function setup() {
  useAuth.setState({ profile: { id: "u1", email: "ravi@example.com", display_name: "Ravi", role: "picker" } });
  useStore.setState({ tasks: [task] });
}

describe("PickerView", () => {
  it("blocks confirmation on a wrong batch scan, and accepts the correct one", async () => {
    setup();
    const user = userEvent.setup();
    render(<PickerView />);

    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));
    await user.click(screen.getByRole("button", { name: "Scan" }));

    const input = screen.getByPlaceholderText(/Batch code/);
    await user.type(input, "WRONG-BATCH");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Scan batch BA019232");

    await user.clear(input);
    await user.type(input, "BA019232");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    // Advanced to line 2 of 2 — the scan was accepted.
    expect(await screen.findByText("Line 2 of 2")).toBeVisible();
  });

  it("shows a structured exception with a reason, not just a bare quantity", async () => {
    setup();
    const user = userEvent.setup();
    render(<PickerView />);

    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));
    await user.click(screen.getByRole("button", { name: "Report an exception" }));

    expect(screen.getByText("Issue")).toBeVisible();
    expect(screen.getByRole("option", { name: "Damaged stock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit exception" })).toBeVisible();
  });
});

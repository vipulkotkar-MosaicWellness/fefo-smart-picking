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

// Two lines so a "Found" tap on line 1 only advances locally — it never
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
  it("shows the location, SKU, batch, and quantity for the current line", async () => {
    const user = userEvent.setup();
    setup();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    expect(screen.getByText("Go to location")).toBeVisible();
    expect(screen.getByText("A1")).toBeVisible();
    expect(screen.getByText("Product A")).toBeVisible();
    expect(screen.getByText("SKU-A", { exact: false })).toBeVisible();
    expect(screen.getByText("BA019232")).toBeVisible();
    expect(screen.getByText("Pick 15")).toBeVisible();
  });

  it("marking a line Found advances to the next line, no scan required", async () => {
    const user = userEvent.setup();
    setup();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    await user.click(screen.getByRole("button", { name: /Found — Picked 15/ }));
    expect(await screen.findByText("Line 2 of 2")).toBeVisible();
    expect(screen.getByText("A2")).toBeVisible();
  });

  it("shows a structured exception with a reason when marked Not found", async () => {
    const user = userEvent.setup();
    setup();
    render(<PickerView />);
    await user.click(screen.getByRole("button", { name: /SL Mother Hub/ }));

    await user.click(screen.getByRole("button", { name: "Not found" }));

    expect(screen.getByText("Issue")).toBeVisible();
    expect(screen.getByRole("option", { name: "Damaged stock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit exception" })).toBeVisible();
  });
});

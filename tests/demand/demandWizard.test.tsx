import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DemandPanel } from "../../src/components/DemandPanel";
import { useStore } from "../../src/lib/store";

const initialState = useStore.getState();

afterEach(() => {
  useStore.setState(initialState, true);
});

function csvFile(content: string) {
  return new File([content], "demand.csv", { type: "text/csv" });
}

describe("DemandPanel wizard", () => {
  it("moves from Import to Validate on upload, and surfaces an unknown channel without crashing", async () => {
    const user = userEvent.setup();
    render(<DemandPanel />);

    await user.upload(screen.getByLabelText(/Upload \.csv/i), csvFile("Nowhere, MWMMHRP.0001.AAAA.B0_N, 10, GP-1001"));

    expect(await screen.findByText("Unknown channel(s)")).toBeVisible();
    expect(screen.getByText((_, el) => el?.textContent === "Unknown channel(s) — Nowhere")).toBeVisible();
    // Nothing valid was parsed, so moving on to allocation should be blocked.
    expect(screen.getByRole("button", { name: "Review allocation" })).toBeDisabled();
  });

  it("lets a valid row proceed through Validate into a real allocation preview", async () => {
    const user = userEvent.setup();
    render(<DemandPanel />);

    const [sku] = Object.keys(useStore.getState().skus);
    await user.upload(screen.getByLabelText(/Upload \.csv/i), csvFile(`Blinkit, ${sku}, 5, GP-1001`));

    expect(await screen.findByRole("button", { name: "Review allocation" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Review allocation" }));

    // Step 3 shows a real facility allocation, not a placeholder.
    expect(screen.getByText(/units allocated/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /^Continue/ }));
    expect(screen.getByText(/Ready to generate/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate picklists" })).toBeEnabled();
  });
});

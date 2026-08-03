import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PartnerDirectory } from "../../src/components/admin/PartnerDirectory";
import { useStore } from "../../src/lib/store";

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState, true));

function fakePng(name: string) {
  return new File(["fake-png-bytes"], name, { type: "image/png" });
}

describe("PartnerDirectory", () => {
  it("shows a pending state after upload, and never renders the logo before approval", async () => {
    const user = userEvent.setup();
    render(<PartnerDirectory />);

    const uploadInputs = screen.getAllByLabelText("Upload logo");
    await user.upload(uploadInputs[0], fakePng("blinkit.png"));

    await waitFor(() => expect(screen.getByText("Pending approval")).toBeVisible());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("only shows the logo image after an explicit Approve", async () => {
    const user = userEvent.setup();
    render(<PartnerDirectory />);

    const uploadInputs = screen.getAllByLabelText("Upload logo");
    await user.upload(uploadInputs[0], fakePng("blinkit.png"));
    await waitFor(() => screen.getByText("Pending approval"));

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.getByText("Logo approved")).toBeVisible();
  });

  it("toggles a partner between Active and Inactive", async () => {
    const user = userEvent.setup();
    render(<PartnerDirectory />);
    const [firstDeactivate] = screen.getAllByRole("button", { name: "Deactivate" });
    await user.click(firstDeactivate);
    expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  });
});

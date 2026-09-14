import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoundTabs } from "../../src/components/RoundTabs";
import type { PicklistFamily } from "../../src/lib/picklistFamilies";
import type { FacilityPicklist } from "../../src/lib/types";

function round(overrides: Partial<FacilityPicklist> = {}): FacilityPicklist {
  return {
    no: "T-MH", taskNo: "T", facility: "SL Mother Hub", status: "open", round: 1, bad: 0,
    lines: [], ...overrides,
  };
}

describe("RoundTabs", () => {
  it("renders nothing for a single-round family", () => {
    const family: PicklistFamily = { key: "T-MH", taskNo: "T", rounds: [round()], latestCreatedAt: "2026-09-14T00:00:00Z" };
    const { container } = render(<RoundTabs family={family} selectedRound={1} onSelectRound={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels round 1 as Original and later rounds as Round N, each with its facility", () => {
    const family: PicklistFamily = {
      key: "T-MH", taskNo: "T",
      rounds: [round({ round: 1, facility: "SL Mother Hub" }), round({ no: "T-AMB-R2", round: 2, facility: "SL Ambient" })],
      latestCreatedAt: "2026-09-14T00:00:00Z",
    };
    render(<RoundTabs family={family} selectedRound={1} onSelectRound={() => {}} />);
    expect(screen.getByText(/Original/)).toBeInTheDocument();
    expect(screen.getByText(/SL Mother Hub/)).toBeInTheDocument();
    expect(screen.getByText(/Round 2/)).toBeInTheDocument();
    expect(screen.getByText(/SL Ambient/)).toBeInTheDocument();
  });

  it("shows a facility-change marker only on a tab whose facility differs from the previous round", () => {
    const family: PicklistFamily = {
      key: "T-MH", taskNo: "T",
      rounds: [
        round({ round: 1, facility: "SL Mother Hub" }),
        round({ no: "T-MH-R2", round: 2, facility: "SL Mother Hub" }), // same facility as round 1
        round({ no: "T-AMB-R3", round: 3, facility: "SL Ambient" }), // different facility
      ],
      latestCreatedAt: "2026-09-14T00:00:00Z",
    };
    render(<RoundTabs family={family} selectedRound={1} onSelectRound={() => {}} />);
    const markers = screen.getAllByTitle("Moved to a different facility than the previous round");
    expect(markers).toHaveLength(1);
  });

  it("calls onSelectRound with the clicked round's number", async () => {
    const user = userEvent.setup();
    const onSelectRound = vi.fn();
    const family: PicklistFamily = {
      key: "T-MH", taskNo: "T",
      rounds: [round({ round: 1 }), round({ no: "T-MH-R2", round: 2 })],
      latestCreatedAt: "2026-09-14T00:00:00Z",
    };
    render(<RoundTabs family={family} selectedRound={1} onSelectRound={onSelectRound} />);
    await user.click(screen.getByRole("button", { name: /Round 2/ }));
    expect(onSelectRound).toHaveBeenCalledWith(2);
  });
});

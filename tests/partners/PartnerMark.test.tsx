import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartnerMark } from "../../src/components/partners/PartnerMark";

describe("PartnerMark", () => {
  it("shows initials and the canonical name when there is no approved logo", () => {
    render(<PartnerMark name="Blinkit" />);
    expect(screen.getByText("Blinkit")).toBeVisible();
    expect(screen.getByText("BL")).toBeVisible();
  });

  it("keeps the partner name accessible even in compact mode", () => {
    render(<PartnerMark name="TATA 1MG" compact />);
    expect(screen.getByLabelText("TATA 1MG")).toBeVisible();
  });
});

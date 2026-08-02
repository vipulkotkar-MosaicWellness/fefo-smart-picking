import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MosaicLogo } from "../../src/components/brand/MosaicLogo";

describe("MosaicLogo", () => {
  it("renders the approved Mosaic logo with accessible text", () => {
    render(<MosaicLogo />);
    expect(screen.getByRole("img", { name: "Mosaic Wellness" })).toBeVisible();
  });
});

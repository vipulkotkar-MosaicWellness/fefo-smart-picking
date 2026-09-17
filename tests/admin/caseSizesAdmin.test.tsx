// tests/admin/caseSizesAdmin.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminConfig } from "../../src/components/AdminConfig";
import { useAuth } from "../../src/lib/authStore";
import { useStore } from "../../src/lib/store";

vi.mock("../../src/lib/caseSizesSupabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/caseSizesSupabase")>();
  return { ...actual, upsertCaseSize: vi.fn(async () => undefined), deleteCaseSize: vi.fn(async () => undefined) };
});

const initialStoreState = useStore.getState();
const initialAuthState = useAuth.getState();
afterEach(() => {
  useStore.setState(initialStoreState, true);
  useAuth.setState(initialAuthState, true);
  vi.clearAllMocks();
});

describe("AdminConfig — case sizes", () => {
  it("lists existing case sizes and lets an admin add a new one", async () => {
    const user = userEvent.setup();
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "super_admin" } });
    useStore.setState({ caseSizes: { "SKU-EXISTING": 40 } });
    render(<AdminConfig />);

    expect(screen.getByText("SKU-EXISTING")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();

    const skuInput = screen.getByLabelText(/sku/i, { selector: "input" });
    const sizeInput = screen.getByLabelText(/case size/i);
    await user.type(skuInput, "SKU-NEW");
    await user.type(sizeInput, "25");
    await user.click(screen.getByRole("button", { name: /add case size|save/i }));

    const caseSizesSupabase = await import("../../src/lib/caseSizesSupabase");
    expect(caseSizesSupabase.upsertCaseSize).toHaveBeenCalledWith("SKU-NEW", 25);
  });

  it("rejects an empty SKU or a case size of 1 or less without calling upsertCaseSize", async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "super_admin" } });
    useStore.setState({ caseSizes: {} });
    render(<AdminConfig />);

    const sizeInput = screen.getByLabelText(/case size/i);
    await user.type(sizeInput, "1");
    await user.click(screen.getByRole("button", { name: /add case size|save/i }));

    const skuInput = screen.getByLabelText(/sku/i, { selector: "input" });
    await user.type(skuInput, "SKU-BAD");
    await user.click(screen.getByRole("button", { name: /add case size|save/i }));

    const caseSizesSupabase = await import("../../src/lib/caseSizesSupabase");
    expect(caseSizesSupabase.upsertCaseSize).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("lets a super admin remove a case size, but hides that control from a plain admin", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    useAuth.setState({ profile: { id: "u1", email: "a@x.com", display_name: "Admin", role: "super_admin" } });
    useStore.setState({ caseSizes: { "SKU-EXISTING": 40 } });
    const { unmount } = render(<AdminConfig />);

    await user.click(screen.getByRole("button", { name: /remove case size/i }));
    const caseSizesSupabase = await import("../../src/lib/caseSizesSupabase");
    expect(caseSizesSupabase.deleteCaseSize).toHaveBeenCalledWith("SKU-EXISTING");
    unmount();
    confirmSpy.mockRestore();

    useAuth.setState({ profile: { id: "u2", email: "b@x.com", display_name: "Plain Admin", role: "admin" } });
    render(<AdminConfig />);
    expect(screen.getByText("SKU-EXISTING")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove case size/i })).not.toBeInTheDocument();
  });
});

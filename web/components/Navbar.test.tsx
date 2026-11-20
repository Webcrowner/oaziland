import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import Navbar from "./Navbar";
import { notifyCartChanged } from "@/lib/cartEvents";
import { renderWithIntl } from "./oazigo/test-utils";

const mocks = vi.hoisted(() => ({
  getMarketplaceCart: vi.fn(),
  getMyProfile: vi.fn(),
  listQuarters: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("@/lib/api", () => ({
  getMarketplaceCart: mocks.getMarketplaceCart,
  getMyProfile: mocks.getMyProfile,
  listQuarters: mocks.listQuarters,
}));
vi.mock("@/lib/push", () => ({ disablePush: vi.fn() }));

describe("Navbar", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getMarketplaceCart.mockReset();
    mocks.getMyProfile.mockReset();
    mocks.listQuarters.mockResolvedValue([]);
  });

  it("renders nav bar icons for search, stays, services, cart and sign-in", () => {
    const { container } = renderWithIntl(<Navbar />);

    expect(screen.getAllByRole("link", { name: "Cart" })[0]).toHaveAttribute("href", "/marketplace/cart");
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute("href", "/login");

    fireEvent.click(screen.getByRole("button", { name: "Stays" }));
    expect(screen.getByRole("menuitem", { name: "Hotels" })).toHaveAttribute("href", "/hotels");
    expect(screen.getByRole("menuitem", { name: "Event Venues" })).toHaveAttribute("href", "/events");

    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    expect(screen.getByRole("menuitem", { name: "Rides (OaziGo)" })).toHaveAttribute("href", "/oazigo");
    expect(screen.getByRole("menuitem", { name: "Marketplace" })).toHaveAttribute("href", "/marketplace");

    const srcs = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src") ?? "");
    for (const iconName of [
      "icons8-gps-48.png",
      "icons8-cart-94.png",
      "icons8-hotel-64.png",
      "icons8-celebration-50.png",
      "icons8-car-100.png",
      "store.png",
      "user.png",
    ]) {
      expect(srcs.some((s) => s.includes(iconName))).toBe(true);
    }
  });

  it("shows the live cart count and opens the profile menu for signed-in users", async () => {
    localStorage.setItem("access_token", "token-1");
    mocks.getMyProfile.mockResolvedValue({
      id: "u1",
      username: "awa",
      full_name: "Awa Ndi",
      is_agent: false,
      is_landlord: false,
      is_technician: false,
      is_driver: false,
      is_student: false,
      is_admin: false,
    });
    mocks.getMarketplaceCart.mockResolvedValueOnce({ item_count: 2 }).mockResolvedValueOnce({ item_count: 5 });

    renderWithIntl(<Navbar />);

    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Cart, 2 items" })[0]).toHaveAttribute("href", "/marketplace/cart");
    });
    expect(mocks.getMarketplaceCart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Messages" }).querySelector("img")?.getAttribute("src")).toContain("chat.png");

    const profileBtn = await screen.findByRole("button", { name: "Awa Ndi" });
    fireEvent.click(profileBtn);
    expect(screen.getByRole("menuitem", { name: "My Account" })).toHaveAttribute("href", "/account");

    await act(async () => {
      notifyCartChanged();
    });

    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Cart, 5 items" })[0]).toBeInTheDocument();
    });
  });
});

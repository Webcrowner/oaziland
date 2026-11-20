import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import ListingOwnerActions from "./ListingOwnerActions";
import { renderWithIntl } from "./oazigo/test-utils";

const mocks = vi.hoisted(() => ({ getMyProfile: vi.fn() }));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/api", () => ({ getMyProfile: mocks.getMyProfile, renewListing: vi.fn() }));

describe("ListingOwnerActions", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "token");
    mocks.getMyProfile.mockReset();
  });

  it("offers the lister a video pre-linked to this property", async () => {
    mocks.getMyProfile.mockResolvedValue({ id: "lister-1" });
    renderWithIntl(<ListingOwnerActions listingId="listing-9" listerId="lister-1" />);

    expect(await screen.findByRole("link", { name: "Post a video of this property" })).toHaveAttribute("href", "/videos/create?listing_id=listing-9");
  });

  it("shows nothing to anyone else, since only the lister can link a video to a property", async () => {
    mocks.getMyProfile.mockResolvedValue({ id: "visitor-2" });
    renderWithIntl(<ListingOwnerActions listingId="listing-9" listerId="lister-1" />);

    await waitFor(() => expect(mocks.getMyProfile).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Post a video of this property" })).not.toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import VenueSpacesBooking from "./VenueSpacesBooking";
import { renderWithIntl } from "./oazigo/test-utils";
import type { Venue } from "@/lib/api";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const venue = {
  id: "v-1", quarter: "q", quarter_name: "Bastos", spaces: [
    { id: "s-1", space_name: "Main hall", capacity_theatre: 300, capacity_banquet: 200, capacity_cocktail: null, capacity_classroom: null, base_price_per_hour_xaf: "50000", catering_policy: "" },
    { id: "s-2", space_name: "Garden", capacity_theatre: null, capacity_banquet: 120, capacity_cocktail: 250, capacity_classroom: null, base_price_per_hour_xaf: "30000", catering_policy: "" },
  ],
} as unknown as Venue;

describe("VenueSpacesBooking", () => {
  it("lists each space with its hourly price and books the space chosen", () => {
    renderWithIntl(<VenueSpacesBooking venue={venue} />);
    expect(screen.getByText("30,000 XAF / hour")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Book" })[1]);

    const space = screen.getByRole("combobox") as HTMLSelectElement;
    expect(space.value).toBe("s-2");
  });
});

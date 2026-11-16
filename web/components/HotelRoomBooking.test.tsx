import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import HotelRoomBooking from "./HotelRoomBooking";
import { renderWithIntl } from "./oazigo/test-utils";
import type { Hotel } from "@/lib/api";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const getHotelAvailability = vi.fn();
vi.mock("@/lib/api", () => ({ getStayAvailability: (...args: unknown[]) => getHotelAvailability(...args) }));

const roomType = (id: string, name: string, rate: string) => ({
  id, name, category: "DELUXE", capacity: 2, base_rate_xaf: rate, photos: [], room_count: 3, amenities: [],
});
const hotel = {
  id: "h-1", quarter_name: "Bonapriso",
  room_types: [roomType("rt-1", "Standard single", "28000"), roomType("rt-2", "Deluxe double", "42000")],
} as unknown as Hotel;

describe("HotelRoomBooking", () => {
  it("shows each room type, then the rooms free and the server's total once dates are chosen", async () => {
    getHotelAvailability.mockResolvedValue({
      check_in: "2030-05-01", check_out: "2030-05-03",
      room_types: [
        { room_type: "rt-1", rooms_free: 2, nights: 2, total_xaf: "56000" },
        { room_type: "rt-2", rooms_free: 0, nights: 2, total_xaf: "84000" },
      ],
    });
    renderWithIntl(<HotelRoomBooking hotel={hotel} title="Bonapriso Residence" />);
    expect(screen.getByText("Deluxe double")).toBeTruthy();
    expect(screen.getByText("28,000 XAF / night")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Check-in"), { target: { value: "2030-05-01" } });
    fireEvent.change(screen.getByLabelText("Check-out"), { target: { value: "2030-05-03" } });

    expect(await screen.findByText("2 nights: 56,000 XAF in total")).toBeTruthy();
    expect(getHotelAvailability).toHaveBeenLastCalledWith("hotels", "h-1", "2030-05-01", "2030-05-03");
    expect(screen.getByText("2 rooms left")).toBeTruthy();
    expect(screen.getByText("Sold out for your dates")).toBeTruthy();
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import HostelRoomTypes from "./HostelRoomTypes";
import { renderWithIntl } from "./oazigo/test-utils";
import type { HostelRoomType } from "@/lib/api";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function roomType(overrides: Partial<HostelRoomType> = {}): HostelRoomType {
  return {
    id: "rt-1", name: "Self-contain, private bathroom", unit_type: "SELF_CONTAIN", occupancy_model: "PER_UNIT",
    beds_per_room: 1, price_xaf: "40000.00", price_period: "MONTH", max_periods: 12, size_sqm: "18.00",
    private_bathroom: true, furnished: true, description: "Tiled, with a balcony.",
    photos: [{ id: 1, url: "https://cdn.example.com/a.jpg" }, { id: 2, url: "https://cdn.example.com/b.jpg" }],
    total_places: 4, available_places: 3, ...overrides,
  };
}

function renderRooms(rooms: HostelRoomType[]) {
  return renderWithIntl(<HostelRoomTypes sharePath="/student-hostels/h-1" hostelTitle="Résidence Les Palmiers" quarterName="Molyko" roomTypes={rooms} />);
}

describe("HostelRoomTypes", () => {
  it("shows each room type's price and places, and opens its photos and details", () => {
    renderRooms([roomType()]);

    const card = screen.getByRole("button", { name: /Self-contain, private bathroom/ });
    expect(within(card).getByText("40,000 XAF / month")).toBeTruthy();
    expect(within(card).getByText("3 places left")).toBeTruthy();

    fireEvent.click(card);
    const dialog = screen.getByRole("dialog", { name: "Self-contain, private bathroom" });
    expect(within(dialog).getByText("Tiled, with a balcony.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Show photo 2" }));
    expect(within(dialog).getByAltText("Self-contain, private bathroom, photo 2")).toBeTruthy();
  });

  it("reserves at the room type's price for the months the student picks", () => {
    renderRooms([roomType()]);
    fireEvent.click(screen.getByRole("button", { name: /Self-contain/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reserve this room" }));

    const months = screen.getByLabelText("Tenure / Term") as HTMLSelectElement;
    expect(months.options).toHaveLength(12);
    expect(months.options[2].text).toBe("3 months");
    fireEvent.change(months, { target: { value: "3" } });
    expect(screen.getByText("120,000 XAF")).toBeTruthy();
  });

  it("does not let students reserve a fully booked room type", () => {
    renderRooms([roomType({ available_places: 0 })]);
    fireEvent.click(screen.getByRole("button", { name: /Self-contain/ }));

    const reserve = within(screen.getByRole("dialog")).getByRole("button", { name: "Fully booked" }) as HTMLButtonElement;
    expect(reserve.disabled).toBe(true);
  });
});

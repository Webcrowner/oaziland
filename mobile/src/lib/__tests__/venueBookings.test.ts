import type { EventBookingItem } from "../api";
import { availableActions, localNowString, validateVenueBooking } from "../venueBookings";

const base: EventBookingItem = {
  id: "1", venue_space: "s", venue_id: "v", space_name: "Hall", event_type: "WEDDING", event_date: "2027-03-20",
  start_time: "10:00:00", end_time: "14:00:00", guest_count: 80, status: "CONFIRMED", total_cost_xaf: "200000",
  deposit_amount_xaf: "60000", balance_amount_xaf: "140000", deposit_paid: true, balance_paid: false, is_organiser: true,
  is_owner: false, organiser_name: "", owner_payout_xaf: null, payment_held: true, payout_due_at: null, balance_due_at: null, cancellation: null,
};

describe("validateVenueBooking", () => {
  const form = { eventType: "Wedding", date: "2027-03-20", start: "10:00", end: "14:00", guests: "80", hourlyRateXaf: 50000 };

  it("prices the event from the hours, like the server", () => {
    expect(validateVenueBooking(form, "2027-01-01")).toEqual({
      ok: true,
      value: { event_type: "Wedding", event_date: "2027-03-20", start_time: "10:00", end_time: "14:00", guest_count: 80, totalXaf: 200000 },
    });
  });

  it("explains each mistake", () => {
    const error = (patch: object) => {
      const r = validateVenueBooking({ ...form, ...patch }, "2027-01-01");
      return r.ok ? "" : r.error;
    };
    expect(error({ eventType: " " })).toMatch(/kind of event/);
    expect(error({ date: "20/03/2027" })).toMatch(/YYYY-MM-DD/);
    expect(error({ date: "2026-12-31" })).toMatch(/past/);
    expect(error({ start: "9am" })).toMatch(/HH:MM/);
    expect(error({ end: "09:00" })).toMatch(/end after/);
    expect(error({ guests: "0" })).toMatch(/guests/);
  });
});

describe("availableActions", () => {
  const before = "2027-03-01T09:00";
  const during = "2027-03-20T11:00";
  const after = "2027-03-21T09:00";

  it("lets the organiser pay the deposit, then the balance, and cancel while it is possible", () => {
    expect(availableActions({ ...base, status: "PENDING", deposit_paid: false }, "organiser", before)).toEqual(["pay-deposit", "cancel"]);
    const cancellation = { free: true, free_until: null, fee_xaf: "0", refund_xaf: "60000" };
    expect(availableActions({ ...base, cancellation }, "organiser", before)).toEqual(["pay-balance", "cancel"]);
  });

  it("only lets the organiser confirm or report once the event has started, and stops balance payments", () => {
    expect(availableActions(base, "organiser", during)).toEqual(["confirm-event", "report"]);
    expect(availableActions({ ...base, payment_held: false, status: "COMPLETED" }, "organiser", after)).toEqual([]);
  });

  it("lets the owner complete only after the event is over and fully paid", () => {
    const owned = { ...base, is_organiser: false, is_owner: true, balance_paid: true };
    expect(availableActions(owned, "owner", during)).toEqual([]);
    expect(availableActions(owned, "owner", after)).toEqual(["complete"]);
    expect(availableActions({ ...owned, balance_paid: false }, "owner", after)).toEqual([]);
  });
});

describe("localNowString", () => {
  it("is a sortable local date and time", () => {
    expect(localNowString(new Date(2027, 2, 5, 9, 7))).toBe("2027-03-05T09:07");
  });
});

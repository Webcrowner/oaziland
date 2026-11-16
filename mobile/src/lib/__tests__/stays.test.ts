import type { StayItem } from "../api";
import { availableStayActions, cancelPrompt, localToday, visibleStays } from "../stays";

const stay: StayItem = {
  id: "1", guest_name: "Ada", place_name: "Hôtel Bastos", place_kind: "hotel", place_id: "h", room_type_name: "Deluxe",
  check_in: "2027-03-10", check_out: "2027-03-12", adults: 2, children: 0, rate_xaf: "80000", status: "CONFIRMED",
  payment_held: true, payout_due_at: null, cancellation: null,
};
const freeQuote = { free: true, free_until: "2027-03-08T12:00:00Z", fee_xaf: "0", refund_xaf: "80000" };
const lateQuote = { free: false, free_until: "2027-03-08T12:00:00Z", fee_xaf: "40000", refund_xaf: "40000" };

describe("availableStayActions", () => {
  it("lets a guest cancel before the stay and confirm or report once it has started", () => {
    expect(availableStayActions({ ...stay, cancellation: freeQuote }, "guest", "2027-03-01")).toEqual(["cancel"]);
    expect(availableStayActions(stay, "guest", "2027-03-10")).toEqual(["confirm-stay", "report"]);
    expect(availableStayActions({ ...stay, status: "CHECKED_OUT", payment_held: false }, "guest", "2027-03-20")).toEqual([]);
  });

  it("lets a guest drop a reservation they never paid for", () => {
    expect(availableStayActions({ ...stay, status: "PENDING_PAYMENT", payment_held: false }, "guest", "2027-03-01")).toEqual(["cancel-unpaid"]);
  });

  it("lets a host check in, check out, record a no-show only after the arrival day, and cancel while allowed", () => {
    expect(availableStayActions({ ...stay, cancellation: freeQuote }, "host", "2027-03-01")).toEqual(["check-in", "cancel"]);
    expect(availableStayActions(stay, "host", "2027-03-10")).toEqual(["check-in"]);
    expect(availableStayActions(stay, "host", "2027-03-11")).toEqual(["check-in", "no-show"]);
    expect(availableStayActions({ ...stay, status: "CHECKED_IN" }, "host", "2027-03-11")).toEqual(["checkout"]);
  });
});

describe("cancelPrompt", () => {
  it("tells a guest exactly what a free and a late cancellation cost", () => {
    expect(cancelPrompt({ ...stay, cancellation: freeQuote }, "guest")).toMatch(/free: 80,000 XAF/);
    const late = cancelPrompt({ ...stay, cancellation: lateQuote }, "guest");
    expect(late).toMatch(/first night \(40,000 XAF\)/);
    expect(late).toMatch(/40,000 XAF goes back/);
  });

  it("tells a host the guest is refunded in full", () => {
    expect(cancelPrompt(stay, "host")).toMatch(/refunded in full/);
  });
});

describe("visibleStays and localToday", () => {
  it("hides a guest's cancelled stays once they are in the past, but never a host's", () => {
    const old = { ...stay, status: "CANCELLED" as const, check_out: "2027-01-02" };
    expect(visibleStays([old, stay], "guest", "2027-03-01")).toEqual([stay]);
    expect(visibleStays([old, stay], "host", "2027-03-01")).toEqual([old, stay]);
  });

  it("formats the local date", () => {
    expect(localToday(new Date(2027, 2, 5, 9, 7))).toBe("2027-03-05");
  });
});

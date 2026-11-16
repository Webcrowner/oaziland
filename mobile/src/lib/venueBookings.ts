import type { EventBookingItem } from "./api";

export interface VenueBookingForm {
  eventType: string;
  date: string;
  start: string;
  end: string;
  guests: string;
  hourlyRateXaf: number;
}

export interface ValidatedVenueBooking {
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  guest_count: number;
  totalXaf: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Checks the booking form the way the server will, so a typo is caught before the request. `today` is "YYYY-MM-DD". */
export function validateVenueBooking(form: VenueBookingForm, today: string): { ok: true; value: ValidatedVenueBooking } | { ok: false; error: string } {
  const eventType = form.eventType.trim();
  if (!eventType) return { ok: false, error: "Say what kind of event it is (wedding, conference...)." };
  if (!DATE.test(form.date) || Number.isNaN(Date.parse(`${form.date}T12:00:00`))) return { ok: false, error: "Enter the date as YYYY-MM-DD, for example 2027-03-20." };
  if (form.date < today) return { ok: false, error: "Pick a date that is not in the past." };
  if (!TIME.test(form.start) || !TIME.test(form.end)) return { ok: false, error: "Enter the times as HH:MM, for example 10:00." };
  const hours = (minutes(form.end) - minutes(form.start)) / 60;
  if (hours <= 0) return { ok: false, error: "The event must end after it starts." };
  const guests = Number(form.guests);
  if (!Number.isInteger(guests) || guests < 1) return { ok: false, error: "Enter how many guests are coming." };
  return {
    ok: true,
    value: {
      event_type: eventType, event_date: form.date, start_time: form.start, end_time: form.end, guest_count: guests,
      totalXaf: Math.round(hours * form.hourlyRateXaf),
    },
  };
}

/** The event's end as "YYYY-MM-DDTHH:MM" in local time, to compare with `now` in the same shape. */
export function eventEnd(booking: Pick<EventBookingItem, "event_date" | "end_time">): string {
  return `${booking.event_date}T${booking.end_time.slice(0, 5)}`;
}

export function eventStart(booking: Pick<EventBookingItem, "event_date" | "start_time">): string {
  return `${booking.event_date}T${booking.start_time.slice(0, 5)}`;
}

export type VenueBookingAction = "pay-deposit" | "pay-balance" | "cancel" | "confirm-event" | "report" | "complete";

/** What the signed-in person can do with a booking right now. The server has the final say; this only decides which
 * buttons to show. `now` is "YYYY-MM-DDTHH:MM" in local time. */
export function availableActions(booking: EventBookingItem, role: "organiser" | "owner", now: string): VenueBookingAction[] {
  const actions: VenueBookingAction[] = [];
  const started = eventStart(booking) <= now;
  const ended = eventEnd(booking) <= now;
  if (role === "organiser") {
    if (booking.status === "PENDING" && !booking.deposit_paid) actions.push("pay-deposit", "cancel");
    if (booking.status === "CONFIRMED" && !booking.balance_paid && !started) actions.push("pay-balance");
    if (booking.cancellation) actions.push("cancel");
    if (booking.status === "CONFIRMED" && booking.payment_held && started) actions.push("confirm-event", "report");
  } else {
    if (booking.status === "CONFIRMED" && booking.payment_held && ended && booking.balance_paid) actions.push("complete");
    if (booking.cancellation) actions.push("cancel");
  }
  return actions;
}

export const STATUS_LABEL: Record<EventBookingItem["status"], string> = {
  PENDING: "Awaiting deposit", CONFIRMED: "Confirmed", COMPLETED: "Completed", CANCELLED: "Cancelled",
};

/** "YYYY-MM-DDTHH:MM" for the device's local clock. */
export function localNowString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

import type { StayItem } from "./api";

export type StayButton = "cancel" | "cancel-unpaid" | "confirm-stay" | "report" | "check-in" | "checkout" | "no-show";

/** What the signed-in person can do with a stay today. The server has the final say; this only decides which buttons
 * to show. `today` is the device's local date as "YYYY-MM-DD". */
export function availableStayActions(stay: StayItem, role: "guest" | "host", today: string): StayButton[] {
  const actions: StayButton[] = [];
  const started = stay.check_in <= today;
  if (role === "guest") {
    if (stay.cancellation) actions.push("cancel");
    if (stay.status === "PENDING_PAYMENT") actions.push("cancel-unpaid");
    if (stay.payment_held && started && (stay.status === "CONFIRMED" || stay.status === "CHECKED_IN")) actions.push("confirm-stay", "report");
  } else {
    if (stay.status === "CONFIRMED") actions.push("check-in");
    if (stay.status === "CHECKED_IN") actions.push("checkout");
    if (stay.status === "CONFIRMED" && stay.check_in < today) actions.push("no-show");
    if (stay.cancellation) actions.push("cancel");
  }
  return actions;
}

export const STAY_STATUS_LABEL: Record<StayItem["status"], string> = {
  PENDING_PAYMENT: "Awaiting payment", CONFIRMED: "Confirmed", CHECKED_IN: "Checked in",
  CHECKED_OUT: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show",
};

export const STAY_STATUS_COLOR: Record<StayItem["status"], string> = {
  PENDING_PAYMENT: "#C9A227", CONFIRMED: "#16A34A", CHECKED_IN: "#0369A1",
  CHECKED_OUT: "#1B2A4A", CANCELLED: "#A8502E", NO_SHOW: "#A8502E",
};

/** The text of the "are you sure" prompt for cancelling, with what the guest pays and gets back. */
export function cancelPrompt(stay: StayItem, role: "guest" | "host"): string {
  const money = (v: string) => `${Number(v).toLocaleString()} XAF`;
  if (role === "host") return "Cancel this reservation? The guest is refunded in full and you receive nothing.";
  const c = stay.cancellation;
  if (!c) return "Cancel this reservation?";
  return c.free
    ? `It is free: ${money(c.refund_xaf)} goes back to your Oaziland wallet. Cancel this stay?`
    : `It is too late for a free cancellation: the host keeps the first night (${money(c.fee_xaf)}) and ${money(c.refund_xaf)} goes back to your Oaziland wallet. Cancel this stay?`;
}

/** Hide old finished or cancelled reservations from the guest's list after a few days, like the web. */
export function visibleStays(stays: StayItem[], role: "guest" | "host", today: string): StayItem[] {
  return role === "host" ? stays : stays.filter((s) => s.status !== "CANCELLED" || s.check_out >= today);
}

/** The device's local date as "YYYY-MM-DD". */
export function localToday(date: Date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

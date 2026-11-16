import type {
  MarketplaceOrderItem, ReturnKind, ReturnReason, ReturnRequest, ReturnRequestPayload, SellerPayoutRow, ShipmentEvent, ShipmentStatus, ShipmentStep, ShipmentUpdate,
} from "./api";
import { parseAmount } from "./marketplaceOffers";

export type OrderRole = "buying" | "selling";

// ---- Delivery tracking -------------------------------------------------

const SHIPMENT_STEPS: ShipmentStep[] = ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];

export const SHIPMENT_LABELS: Record<ShipmentStep | "REPLACEMENT", string> = {
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  REPLACEMENT: "Replacement sent",
};

export function shipmentEventLabel(status: ShipmentEvent["status"]): string {
  return SHIPMENT_LABELS[status] ?? status;
}

/** Statuses only move forward, so only the steps after the current one are offered. */
export function nextShipmentStatuses(current: ShipmentStatus): ShipmentStep[] {
  return current === "" ? [...SHIPMENT_STEPS] : SHIPMENT_STEPS.slice(SHIPMENT_STEPS.indexOf(current) + 1);
}

/** The seller can post shipment updates on a tracked order that has not been delivered yet. */
export function canUpdateShipment(order: Pick<MarketplaceOrderItem, "status" | "is_tracked" | "shipment_status">, role: OrderRole): boolean {
  return role === "selling" && order.is_tracked && (order.status === "PAID" || order.status === "HANDED_OVER") && order.shipment_status !== "DELIVERED";
}

export function hasTracking(order: Pick<MarketplaceOrderItem, "is_tracked" | "courier_name" | "tracking_number" | "shipment_events" | "delivery_proof_url">): boolean {
  return order.is_tracked || !!order.courier_name || !!order.tracking_number || order.shipment_events.length > 0 || !!order.delivery_proof_url;
}

export interface ShipmentDraft {
  status: ShipmentStep | "";
  courier_name: string;
  tracking_number: string;
  note: string;
  proof_url: string;
}

export function shipmentDraftFor(order: Pick<MarketplaceOrderItem, "shipment_status" | "courier_name" | "tracking_number">): ShipmentDraft {
  return { status: nextShipmentStatuses(order.shipment_status)[0] ?? "", courier_name: order.courier_name, tracking_number: order.tracking_number, note: "", proof_url: "" };
}

export function shipmentDraftError(draft: ShipmentDraft, order: Pick<MarketplaceOrderItem, "shipment_status" | "delivery_method">): string {
  if (!draft.status || !nextShipmentStatuses(order.shipment_status).includes(draft.status)) return "Choose the next delivery step.";
  if (order.delivery_method === "COURIER" && !draft.courier_name.trim()) return "Enter the courier name.";
  if (draft.status === "DELIVERED" && !draft.proof_url && !draft.note.trim()) return "Add a proof photo or a note to mark it as delivered.";
  return "";
}

export function shipmentPayload(draft: ShipmentDraft): ShipmentUpdate {
  const update: ShipmentUpdate = { status: draft.status as ShipmentStep };
  if (draft.courier_name.trim()) update.courier_name = draft.courier_name.trim();
  if (draft.tracking_number.trim()) update.tracking_number = draft.tracking_number.trim();
  if (draft.note.trim()) update.note = draft.note.trim();
  if (draft.status === "DELIVERED" && draft.proof_url) update.proof_url = draft.proof_url;
  return update;
}

// ---- Returns and refunds -----------------------------------------------

export const MAX_RETURN_EVIDENCE = 5;
export const MIN_RETURN_DESCRIPTION = 10;
export const MIN_REJECT_NOTE = 5;

export const RETURN_KINDS: { key: ReturnKind; label: string }[] = [
  { key: "REFUND", label: "Full refund" },
  { key: "PARTIAL_REFUND", label: "Partial refund" },
  { key: "REPLACEMENT", label: "Replacement" },
];

export const RETURN_REASONS: { key: ReturnReason; label: string }[] = [
  { key: "NOT_AS_DESCRIBED", label: "Not as described" },
  { key: "DAMAGED", label: "Damaged" },
  { key: "WRONG_ITEM", label: "Wrong item" },
  { key: "MISSING_PARTS", label: "Missing parts" },
  { key: "NOT_WORKING", label: "Not working" },
  { key: "OTHER", label: "Other" },
];

export const returnKindLabel = (kind: ReturnKind) => RETURN_KINDS.find((k) => k.key === kind)?.label ?? kind;
export const returnReasonLabel = (reason: ReturnReason) => RETURN_REASONS.find((r) => r.key === reason)?.label ?? reason;

/** A request is open while it waits for the seller or after the seller rejected it and the buyer has not decided. */
export function isReturnOpen(request: Pick<ReturnRequest, "status"> | null | undefined): boolean {
  return !!request && (request.status === "REQUESTED" || request.status === "REJECTED");
}

export type ReturnAction = "accept" | "reject" | "withdraw" | "escalate";

function isPast(iso: string | null, now: Date): boolean {
  return !!iso && new Date(iso).getTime() < now.getTime();
}

export function returnActions(request: ReturnRequest | null | undefined, role: OrderRole, now: Date = new Date()): ReturnAction[] {
  if (!request || !isReturnOpen(request)) return [];
  if (role === "selling") return request.status === "REQUESTED" ? ["accept", "reject"] : [];
  const actions: ReturnAction[] = ["withdraw"];
  if (request.status === "REJECTED" || (request.status === "REQUESTED" && isPast(request.respond_by, now))) actions.push("escalate");
  return actions;
}

export function returnStatusLabel(request: Pick<ReturnRequest, "status">, role: OrderRole): string {
  switch (request.status) {
    case "REQUESTED": return role === "selling" ? "Waiting for your answer" : "Waiting for the seller";
    case "ACCEPTED": return "Accepted";
    case "REJECTED": return role === "selling" ? "You rejected it" : "Rejected by the seller";
    case "ESCALATED": return "With support";
    case "WITHDRAWN": return "Withdrawn";
    case "CLOSED": return "Closed";
  }
}

export function returnOutcomeText(request: ReturnRequest, role: OrderRole): string {
  const mine = role === "selling";
  switch (request.status) {
    case "REQUESTED":
      return mine
        ? "Accept or reject this request. If you do not answer in time, the buyer can send it to support."
        : "The seller has been asked to respond. If they do not answer in time, you can send it to support.";
    case "ACCEPTED":
      if (request.kind === "REPLACEMENT") return mine ? "You accepted. Send the replacement and update the delivery." : "Accepted. The seller will send a replacement.";
      return mine ? "You accepted. The buyer is refunded." : "Accepted. Your refund is on its way.";
    case "REJECTED":
      return mine
        ? "You rejected the request. The buyer may send it to support or withdraw it."
        : "The seller rejected your request. You can send it to support or withdraw it.";
    case "ESCALATED": return "Support is reviewing this request and will decide the outcome.";
    case "WITHDRAWN": return "The request was withdrawn.";
    case "CLOSED": return "The request is closed.";
  }
}

/** The deadline that matters to the viewer right now, if any. */
export function returnDeadline(request: ReturnRequest, role: OrderRole): { label: string; at: string } | null {
  if (request.status === "REQUESTED" && request.respond_by) return { label: role === "selling" ? "Respond by" : "Seller should respond by", at: request.respond_by };
  if (request.status === "REJECTED" && request.buyer_decide_by) return { label: role === "selling" ? "Buyer can decide until" : "Decide by", at: request.buyer_decide_by };
  return null;
}

/** Confirming receipt closes an open request, so the buyer is warned first. */
export function confirmReceiptMessage(order: Pick<MarketplaceOrderItem, "return_request">): string {
  const base = "Confirm you received what you paid for? The seller will be paid.";
  return isReturnOpen(order.return_request) ? `${base} Your open return request will be closed.` : base;
}

export interface ReturnDraft {
  kind: ReturnKind;
  reason: ReturnReason | "";
  description: string;
  amount: string;
  evidence: string[];
}

export const EMPTY_RETURN_DRAFT: ReturnDraft = { kind: "REFUND", reason: "", description: "", amount: "", evidence: [] };

export function returnDraftError(draft: ReturnDraft, orderAmountXaf: string | number): string {
  if (!draft.reason) return "Choose a reason.";
  if (draft.description.trim().length < MIN_RETURN_DESCRIPTION) return `Describe the problem in at least ${MIN_RETURN_DESCRIPTION} characters.`;
  if (draft.evidence.length > MAX_RETURN_EVIDENCE) return `You can add up to ${MAX_RETURN_EVIDENCE} photos.`;
  if (draft.kind === "PARTIAL_REFUND") {
    const amount = parseAmount(draft.amount);
    const total = Number(orderAmountXaf);
    if (amount === null) return "Enter the refund amount you are asking for.";
    if (amount >= total) return `The partial refund must be less than the order amount (${total.toLocaleString("en-US")} XAF).`;
  }
  return "";
}

export function returnPayload(draft: ReturnDraft): ReturnRequestPayload {
  const payload: ReturnRequestPayload = { kind: draft.kind, reason: draft.reason as ReturnReason, description: draft.description.trim() };
  if (draft.evidence.length) payload.evidence_urls = draft.evidence.slice(0, MAX_RETURN_EVIDENCE);
  if (draft.kind === "PARTIAL_REFUND") payload.requested_amount_xaf = parseAmount(draft.amount) ?? undefined;
  return payload;
}

export function rejectNoteError(note: string): string {
  return note.trim().length < MIN_REJECT_NOTE ? `Tell the buyer why in at least ${MIN_REJECT_NOTE} characters.` : "";
}

// ---- Receipt summary ---------------------------------------------------

export interface ReceiptLine { label: string; value: string }

const money = (value: number) => `${Math.round(value).toLocaleString("en-US")} XAF`;

/** The figures of the PDF receipt, shown in the app because the PDF needs an authenticated download. */
export function receiptLines(order: MarketplaceOrderItem): ReceiptLine[] {
  const fee = Number(order.delivery_fee_xaf) || 0;
  const deposit = Number(order.deposit_xaf) || 0;
  const breakdownPrice = Number(order.price_breakdown?.price_xaf);
  const price = Number.isFinite(breakdownPrice) && order.price_breakdown?.price_xaf !== undefined ? breakdownPrice : Number(order.amount_xaf) - fee;
  const lines: ReceiptLine[] = [
    { label: "Item", value: order.listing_title },
    { label: "Quantity", value: String(order.quantity || 1) },
    { label: "Price", value: money(price) },
  ];
  if (fee > 0) lines.push({ label: "Delivery fee", value: money(fee) });
  if (deposit > 0) lines.push({ label: "Deposit", value: money(deposit) });
  lines.push({ label: "Total paid", value: money(Number(order.total_xaf)) });
  return lines;
}

export function payoutLines(payout: SellerPayoutRow): ReceiptLine[] {
  const lines: ReceiptLine[] = [{ label: "Platform fee", value: `- ${money(Number(payout.fee_xaf))}` }];
  if (Number(payout.refunded_xaf) > 0) lines.push({ label: "Refunded", value: `- ${money(Number(payout.refunded_xaf))}` });
  lines.push({ label: "Your payout", value: money(Number(payout.net_xaf)) });
  return lines;
}

export function receiptText(order: MarketplaceOrderItem, extra: ReceiptLine[] = []): string {
  const rows = [...receiptLines(order), ...extra].map((l) => `${l.label}: ${l.value}`);
  return [`Receipt for order ${order.id}`, ...rows].join("\n");
}

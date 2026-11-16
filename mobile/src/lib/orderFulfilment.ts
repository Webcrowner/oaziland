import type {
  MarketplaceOrderItem, ReturnKind, ReturnReason, ReturnRequest, ReturnRequestPayload, SellerPayoutRow, ShipmentEvent, ShipmentStatus, ShipmentStep, ShipmentUpdate,
} from "./api";
import { parseAmount } from "./marketplaceOffers";
import { translateEnglish, type Translate } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages";

export type OrderRole = "buying" | "selling";

// ---- Delivery tracking -------------------------------------------------

const SHIPMENT_STEPS: ShipmentStep[] = ["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"];

export const SHIPMENT_LABELS: Record<ShipmentStep | "REPLACEMENT", string> = {
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  REPLACEMENT: "Replacement sent",
};

const SHIPMENT_KEYS: Record<ShipmentStep | "REPLACEMENT", MessageKey> = {
  IN_TRANSIT: "mkt.orders.shipment.IN_TRANSIT",
  OUT_FOR_DELIVERY: "mkt.orders.shipment.OUT_FOR_DELIVERY",
  DELIVERED: "mkt.orders.shipment.DELIVERED",
  REPLACEMENT: "mkt.orders.shipment.REPLACEMENT",
};

export function shipmentEventLabel(status: ShipmentEvent["status"], t: Translate = translateEnglish): string {
  const key = SHIPMENT_KEYS[status];
  return key ? t(key) : status;
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

export function shipmentDraftError(draft: ShipmentDraft, order: Pick<MarketplaceOrderItem, "shipment_status" | "delivery_method">, t: Translate = translateEnglish): string {
  if (!draft.status || !nextShipmentStatuses(order.shipment_status).includes(draft.status)) return t("mkt.orders.error.chooseStep");
  if (order.delivery_method === "COURIER" && !draft.courier_name.trim()) return t("mkt.orders.error.courierName");
  if (draft.status === "DELIVERED" && !draft.proof_url && !draft.note.trim()) return t("mkt.orders.error.proofOrNote");
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

const RETURN_KIND_KEYS: Record<ReturnKind, MessageKey> = {
  REFUND: "mkt.orders.returnKind.REFUND",
  PARTIAL_REFUND: "mkt.orders.returnKind.PARTIAL_REFUND",
  REPLACEMENT: "mkt.orders.returnKind.REPLACEMENT",
};

const RETURN_REASON_KEYS: Record<ReturnReason, MessageKey> = {
  NOT_AS_DESCRIBED: "mkt.orders.returnReason.NOT_AS_DESCRIBED",
  DAMAGED: "mkt.orders.returnReason.DAMAGED",
  WRONG_ITEM: "mkt.orders.returnReason.WRONG_ITEM",
  MISSING_PARTS: "mkt.orders.returnReason.MISSING_PARTS",
  NOT_WORKING: "mkt.orders.returnReason.NOT_WORKING",
  OTHER: "mkt.orders.returnReason.OTHER",
};

export const returnKindLabel = (kind: ReturnKind, t: Translate = translateEnglish) => (RETURN_KIND_KEYS[kind] ? t(RETURN_KIND_KEYS[kind]) : kind);
export const returnReasonLabel = (reason: ReturnReason, t: Translate = translateEnglish) => (RETURN_REASON_KEYS[reason] ? t(RETURN_REASON_KEYS[reason]) : reason);

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

export function returnStatusLabel(request: Pick<ReturnRequest, "status">, role: OrderRole, t: Translate = translateEnglish): string {
  switch (request.status) {
    case "REQUESTED": return role === "selling" ? t("mkt.orders.returnStatus.requestedSelling") : t("mkt.orders.returnStatus.requestedBuying");
    case "ACCEPTED": return t("mkt.orders.returnStatus.accepted");
    case "REJECTED": return role === "selling" ? t("mkt.orders.returnStatus.rejectedSelling") : t("mkt.orders.returnStatus.rejectedBuying");
    case "ESCALATED": return t("mkt.orders.returnStatus.escalated");
    case "WITHDRAWN": return t("mkt.orders.returnStatus.withdrawn");
    case "CLOSED": return t("mkt.orders.returnStatus.closed");
  }
}

export function returnOutcomeText(request: ReturnRequest, role: OrderRole, t: Translate = translateEnglish): string {
  const mine = role === "selling";
  switch (request.status) {
    case "REQUESTED":
      return mine ? t("mkt.orders.outcome.requestedSelling") : t("mkt.orders.outcome.requestedBuying");
    case "ACCEPTED":
      if (request.kind === "REPLACEMENT") return mine ? t("mkt.orders.outcome.acceptedReplacementSelling") : t("mkt.orders.outcome.acceptedReplacementBuying");
      return mine ? t("mkt.orders.outcome.acceptedRefundSelling") : t("mkt.orders.outcome.acceptedRefundBuying");
    case "REJECTED":
      return mine ? t("mkt.orders.outcome.rejectedSelling") : t("mkt.orders.outcome.rejectedBuying");
    case "ESCALATED": return t("mkt.orders.outcome.escalated");
    case "WITHDRAWN": return t("mkt.orders.outcome.withdrawn");
    case "CLOSED": return t("mkt.orders.outcome.closed");
  }
}

/** The deadline that matters to the viewer right now, if any. */
export function returnDeadline(request: ReturnRequest, role: OrderRole, t: Translate = translateEnglish): { label: string; at: string } | null {
  if (request.status === "REQUESTED" && request.respond_by) return { label: role === "selling" ? t("mkt.orders.deadline.respondBy") : t("mkt.orders.deadline.sellerShouldRespondBy"), at: request.respond_by };
  if (request.status === "REJECTED" && request.buyer_decide_by) return { label: role === "selling" ? t("mkt.orders.deadline.buyerCanDecideUntil") : t("mkt.orders.deadline.decideBy"), at: request.buyer_decide_by };
  return null;
}

/** Confirming receipt closes an open request, so the buyer is warned first. */
export function confirmReceiptMessage(order: Pick<MarketplaceOrderItem, "return_request">, t: Translate = translateEnglish): string {
  const base = t("mkt.orders.confirmReceipt");
  return isReturnOpen(order.return_request) ? `${base} ${t("mkt.orders.confirmReceiptClosesReturn")}` : base;
}

export interface ReturnDraft {
  kind: ReturnKind;
  reason: ReturnReason | "";
  description: string;
  amount: string;
  evidence: string[];
}

export const EMPTY_RETURN_DRAFT: ReturnDraft = { kind: "REFUND", reason: "", description: "", amount: "", evidence: [] };

export function returnDraftError(draft: ReturnDraft, orderAmountXaf: string | number, t: Translate = translateEnglish, locale = "en-US"): string {
  if (!draft.reason) return t("mkt.orders.error.chooseReason");
  if (draft.description.trim().length < MIN_RETURN_DESCRIPTION) return t("mkt.orders.error.describeMin", { min: MIN_RETURN_DESCRIPTION });
  if (draft.evidence.length > MAX_RETURN_EVIDENCE) return t("mkt.orders.error.maxPhotos", { max: MAX_RETURN_EVIDENCE });
  if (draft.kind === "PARTIAL_REFUND") {
    const amount = parseAmount(draft.amount);
    const total = Number(orderAmountXaf);
    if (amount === null) return t("mkt.orders.error.enterRefundAmount");
    if (amount >= total) return t("mkt.orders.error.partialTooHigh", { total: total.toLocaleString(locale) });
  }
  return "";
}

export function returnPayload(draft: ReturnDraft): ReturnRequestPayload {
  const payload: ReturnRequestPayload = { kind: draft.kind, reason: draft.reason as ReturnReason, description: draft.description.trim() };
  if (draft.evidence.length) payload.evidence_urls = draft.evidence.slice(0, MAX_RETURN_EVIDENCE);
  if (draft.kind === "PARTIAL_REFUND") payload.requested_amount_xaf = parseAmount(draft.amount) ?? undefined;
  return payload;
}

export function rejectNoteError(note: string, t: Translate = translateEnglish): string {
  return note.trim().length < MIN_REJECT_NOTE ? t("mkt.orders.error.rejectNoteMin", { min: MIN_REJECT_NOTE }) : "";
}

// ---- Receipt summary ---------------------------------------------------

export interface ReceiptLine { label: string; value: string }

const money = (value: number, locale: string) => `${Math.round(value).toLocaleString(locale)} XAF`;

/** The figures of the PDF receipt, shown in the app because the PDF needs an authenticated download. */
export function receiptLines(order: MarketplaceOrderItem, t: Translate = translateEnglish, locale = "en-US"): ReceiptLine[] {
  const fee = Number(order.delivery_fee_xaf) || 0;
  const deposit = Number(order.deposit_xaf) || 0;
  const breakdownPrice = Number(order.price_breakdown?.price_xaf);
  const price = Number.isFinite(breakdownPrice) && order.price_breakdown?.price_xaf !== undefined ? breakdownPrice : Number(order.amount_xaf) - fee;
  const lines: ReceiptLine[] = [
    { label: t("mkt.orders.receipt.item"), value: order.listing_title },
    { label: t("mkt.orders.receipt.quantity"), value: String(order.quantity || 1) },
    { label: t("mkt.orders.receipt.price"), value: money(price, locale) },
  ];
  if (fee > 0) lines.push({ label: t("mkt.orders.receipt.deliveryFee"), value: money(fee, locale) });
  if (deposit > 0) lines.push({ label: t("mkt.orders.receipt.deposit"), value: money(deposit, locale) });
  lines.push({ label: t("mkt.orders.receipt.totalPaid"), value: money(Number(order.total_xaf), locale) });
  return lines;
}

export function payoutLines(payout: SellerPayoutRow, t: Translate = translateEnglish, locale = "en-US"): ReceiptLine[] {
  const lines: ReceiptLine[] = [{ label: t("mkt.orders.receipt.platformFee"), value: `- ${money(Number(payout.fee_xaf), locale)}` }];
  if (Number(payout.refunded_xaf) > 0) lines.push({ label: t("mkt.orders.receipt.refunded"), value: `- ${money(Number(payout.refunded_xaf), locale)}` });
  lines.push({ label: t("mkt.orders.receipt.yourPayout"), value: money(Number(payout.net_xaf), locale) });
  return lines;
}

export function receiptText(order: MarketplaceOrderItem, extra: ReceiptLine[] = [], t: Translate = translateEnglish, locale = "en-US"): string {
  const rows = [...receiptLines(order, t, locale), ...extra].map((l) => `${l.label}: ${l.value}`);
  return [t("mkt.orders.receipt.forOrder", { id: order.id }), ...rows].join("\n");
}

import {
  EMPTY_RETURN_DRAFT, canUpdateShipment, confirmReceiptMessage, isReturnOpen, nextShipmentStatuses, receiptLines, rejectNoteError, returnActions,
  returnDeadline, returnDraftError, returnPayload, shipmentDraftError, shipmentPayload,
} from "../orderFulfilment";
import type { MarketplaceOrderItem, ReturnRequest } from "../api";

function request(overrides: Partial<ReturnRequest> = {}): ReturnRequest {
  return {
    id: "r1", kind: "REFUND", reason: "DAMAGED", description: "It arrived broken", evidence_urls: [], requested_amount_xaf: null, status: "REQUESTED",
    seller_note: "", created_at: "2026-11-01T10:00:00Z", responded_at: null, respond_by: "2026-11-05T10:00:00Z", buyer_decide_by: null, ...overrides,
  };
}

describe("shipment steps", () => {
  it("only offers steps after the current one", () => {
    expect(nextShipmentStatuses("")).toEqual(["IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"]);
    expect(nextShipmentStatuses("IN_TRANSIT")).toEqual(["OUT_FOR_DELIVERY", "DELIVERED"]);
    expect(nextShipmentStatuses("DELIVERED")).toEqual([]);
  });

  it("shows the form to the seller of an undelivered tracked order only", () => {
    const order = { status: "PAID", is_tracked: true, shipment_status: "" } as const;
    expect(canUpdateShipment(order, "selling")).toBe(true);
    expect(canUpdateShipment(order, "buying")).toBe(false);
    expect(canUpdateShipment({ ...order, is_tracked: false }, "selling")).toBe(false);
    expect(canUpdateShipment({ ...order, shipment_status: "DELIVERED" }, "selling")).toBe(false);
    expect(canUpdateShipment({ ...order, status: "COMPLETED" }, "selling")).toBe(false);
  });

  it("validates courier, proof and builds the payload", () => {
    const draft = { status: "IN_TRANSIT" as const, courier_name: " ", tracking_number: " TRK1 ", note: "", proof_url: "" };
    expect(shipmentDraftError(draft, { shipment_status: "", delivery_method: "COURIER" })).toMatch(/courier/);
    expect(shipmentDraftError(draft, { shipment_status: "", delivery_method: "SELLER" })).toBe("");
    expect(shipmentDraftError({ ...draft, status: "IN_TRANSIT" }, { shipment_status: "OUT_FOR_DELIVERY", delivery_method: "SELLER" })).toMatch(/next/);
    const delivered = { ...draft, status: "DELIVERED" as const, courier_name: "DHL" };
    expect(shipmentDraftError(delivered, { shipment_status: "", delivery_method: "COURIER" })).toMatch(/proof/);
    expect(shipmentDraftError({ ...delivered, note: "Left with guard" }, { shipment_status: "", delivery_method: "COURIER" })).toBe("");
    expect(shipmentPayload({ ...delivered, proof_url: "http://x/p.jpg" })).toEqual({ status: "DELIVERED", courier_name: "DHL", tracking_number: "TRK1", proof_url: "http://x/p.jpg" });
    expect(shipmentPayload(draft)).toEqual({ status: "IN_TRANSIT", tracking_number: "TRK1" });
  });
});

describe("return actions", () => {
  const before = new Date("2026-11-02T00:00:00Z");
  const after = new Date("2026-11-06T00:00:00Z");

  it("treats requested and rejected as open", () => {
    expect(isReturnOpen(request())).toBe(true);
    expect(isReturnOpen(request({ status: "REJECTED" }))).toBe(true);
    expect(isReturnOpen(request({ status: "ACCEPTED" }))).toBe(false);
    expect(isReturnOpen(null)).toBe(false);
  });

  it("lets the seller answer only a request that is waiting", () => {
    expect(returnActions(request(), "selling", before)).toEqual(["accept", "reject"]);
    expect(returnActions(request({ status: "REJECTED" }), "selling", before)).toEqual([]);
  });

  it("lets the buyer withdraw, and escalate once rejected or overdue", () => {
    expect(returnActions(request(), "buying", before)).toEqual(["withdraw"]);
    expect(returnActions(request(), "buying", after)).toEqual(["withdraw", "escalate"]);
    expect(returnActions(request({ status: "REJECTED" }), "buying", before)).toEqual(["withdraw", "escalate"]);
    expect(returnActions(request({ status: "ESCALATED" }), "buying", after)).toEqual([]);
  });

  it("picks the deadline that applies", () => {
    expect(returnDeadline(request(), "selling")?.label).toBe("Respond by");
    expect(returnDeadline(request({ status: "REJECTED", buyer_decide_by: "2026-11-09T00:00:00Z" }), "buying")?.at).toBe("2026-11-09T00:00:00Z");
    expect(returnDeadline(request({ status: "ACCEPTED" }), "buying")).toBeNull();
  });

  it("warns that confirming receipt closes an open request", () => {
    expect(confirmReceiptMessage({ return_request: request() })).toMatch(/closed/);
    expect(confirmReceiptMessage({ return_request: null })).not.toMatch(/closed/);
  });

  it("requires a note of 5+ characters to reject", () => {
    expect(rejectNoteError("no")).not.toBe("");
    expect(rejectNoteError(" fine. ")).toBe("");
  });
});

describe("return form", () => {
  const valid = { ...EMPTY_RETURN_DRAFT, reason: "DAMAGED" as const, description: "The screen is cracked" };

  it("needs a reason and a 10 character description", () => {
    expect(returnDraftError(EMPTY_RETURN_DRAFT, "50000")).toMatch(/reason/);
    expect(returnDraftError({ ...valid, description: "too short" }, "50000")).toMatch(/10/);
    expect(returnDraftError(valid, "50000")).toBe("");
  });

  it("bounds a partial refund below the order amount and caps photos", () => {
    const partial = { ...valid, kind: "PARTIAL_REFUND" as const };
    expect(returnDraftError(partial, "50000")).toMatch(/amount/);
    expect(returnDraftError({ ...partial, amount: "50000" }, "50000")).toMatch(/less than/);
    expect(returnDraftError({ ...partial, amount: "20 000" }, "50000")).toBe("");
    expect(returnDraftError({ ...valid, evidence: ["a", "b", "c", "d", "e", "f"] }, "50000")).toMatch(/5/);
  });

  it("builds the payload", () => {
    expect(returnPayload({ ...valid, kind: "PARTIAL_REFUND", amount: "20 000", evidence: ["u1"] })).toEqual({
      kind: "PARTIAL_REFUND", reason: "DAMAGED", description: "The screen is cracked", evidence_urls: ["u1"], requested_amount_xaf: 20000,
    });
    expect(returnPayload(valid)).toEqual({ kind: "REFUND", reason: "DAMAGED", description: "The screen is cracked" });
  });
});

describe("receipt", () => {
  it("splits the price from the delivery fee and adds the deposit", () => {
    const order = { listing_title: "Drill", quantity: 2, amount_xaf: "21000", delivery_fee_xaf: "1000", deposit_xaf: "5000", total_xaf: "26000", price_breakdown: {} } as unknown as MarketplaceOrderItem;
    expect(receiptLines(order)).toEqual([
      { label: "Item", value: "Drill" },
      { label: "Quantity", value: "2" },
      { label: "Price", value: "20,000 XAF" },
      { label: "Delivery fee", value: "1,000 XAF" },
      { label: "Deposit", value: "5,000 XAF" },
      { label: "Total paid", value: "26,000 XAF" },
    ]);
  });
});

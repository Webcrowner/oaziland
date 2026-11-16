"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { downloadMarketplaceReceipt, type MarketplaceOrderItem } from "@/lib/api";

/** The buyer's receipt or the seller's sales statement, as a PDF in the current language. */
export default function OrderReceiptButton({ order, role }: { order: MarketplaceOrderItem; role: "buying" | "selling" }) {
  const t = useTranslations("OrderShipment");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!order.receipt_available) return null;

  async function download() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      await downloadMarketplaceReceipt(order.id, locale, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("downloadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button onClick={download} disabled={busy} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer disabled:opacity-50">
        {busy ? t("downloading") : t(role === "buying" ? "downloadReceipt" : "downloadStatement")}
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

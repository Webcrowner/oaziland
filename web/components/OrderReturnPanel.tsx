"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  escalateMarketplaceReturn, respondToMarketplaceReturn, withdrawMarketplaceReturn, type MarketplaceOrderItem,
} from "@/lib/api";
import { isPast } from "@/lib/marketplaceOrderFlow";
import ReturnRequestForm from "@/components/ReturnRequestForm";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const MIN_REJECT_NOTE = 5;

/** A return or refund request on an order: the buyer asks, the seller accepts or rejects, and either side can follow its deadlines. */
export default function OrderReturnPanel({ order, role, onChanged }: { order: MarketplaceOrderItem; role: "buying" | "selling"; onChanged: () => void }) {
  const t = useTranslations("OrderReturn");
  const format = useFormatter();
  const [requesting, setRequesting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = order.return_request;

  if (!request) {
    if (role !== "buying" || !order.can_request_return) return null;
    return requesting ? (
      <ReturnRequestForm order={order} onSaved={() => { setRequesting(false); onChanged(); }} onCancel={() => setRequesting(false)} />
    ) : (
      <button onClick={() => setRequesting(true)} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("request")}</button>
    );
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const token = () => localStorage.getItem("access_token");
  const pastRespondBy = isPast(request.respond_by);
  const canEscalate = role === "buying" && (request.status === "REJECTED" || (request.status === "REQUESTED" && pastRespondBy));

  async function act(call: (accessToken: string) => Promise<unknown>) {
    const accessToken = token();
    if (!accessToken) return;
    setBusy(true);
    setError("");
    try {
      await call(accessToken);
      setRejecting(false);
      setNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  function deadline() {
    if (request?.status === "REQUESTED" && request.respond_by) {
      if (pastRespondBy) return t(role === "buying" ? "answerLateBuyer" : "answerLateSeller");
      return t(role === "buying" ? "answerByBuyer" : "answerBySeller", { date: date(request.respond_by) });
    }
    if (request?.status === "REJECTED" && request.buyer_decide_by) {
      return t(role === "buying" ? "decideByBuyer" : "decideBySeller", { date: date(request.buyer_decide_by) });
    }
    return "";
  }

  const outcome = ["ACCEPTED", "ESCALATED", "WITHDRAWN", "CLOSED"].includes(request.status)
    ? t(request.status === "ACCEPTED" ? `outcome_ACCEPTED_${request.kind}` : `outcome_${request.status}`)
    : "";
  const deadlineText = deadline();

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{t("title")}</p>
        <Badge variant={request.status === "ACCEPTED" ? "green" : request.status === "REQUESTED" || request.status === "REJECTED" ? "gold" : "neutral"}>{t(`status_${request.status}`)}</Badge>
      </div>
      <p className="text-sm text-slate-700">
        {t(`kind_${request.kind}`)}
        {request.kind === "PARTIAL_REFUND" && request.requested_amount_xaf ? ` · ${Number(request.requested_amount_xaf).toLocaleString()} XAF` : ""}
        {` · ${t(`reason_${request.reason}`)}`}
      </p>
      <p className="text-sm text-slate-600 whitespace-pre-line">{request.description}</p>
      {request.evidence_urls.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {request.evidence_urls.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={t("evidenceAlt")} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {request.seller_note && (
        <p className="rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-700 whitespace-pre-line">
          <span className="font-semibold">{t("sellerNote")}</span> {request.seller_note}
        </p>
      )}
      {deadlineText && <p className="text-xs font-semibold text-amber-800">{deadlineText}</p>}
      {outcome && <p className="text-sm font-semibold text-slate-800">{outcome}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {rejecting ? (
        <div className="flex flex-col gap-2">
          <textarea
            rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
            placeholder={t("rejectPlaceholder")} aria-label={t("rejectPlaceholder")} className="border rounded-lg px-3 py-2 text-sm bg-white"
          />
          <div className="flex gap-3">
            <Button
              onClick={() => act((accessToken) => respondToMarketplaceReturn(order.id, "REJECT", note.trim(), accessToken))}
              disabled={busy || note.trim().length < MIN_REJECT_NOTE}
            >
              {t("sendRejection")}
            </Button>
            <button onClick={() => setRejecting(false)} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("cancel")}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {role === "selling" && request.status === "REQUESTED" && (
            <>
              <Button
                disabled={busy}
                onClick={() => { if (window.confirm(t(`confirmAccept_${request.kind}`))) act((accessToken) => respondToMarketplaceReturn(order.id, "ACCEPT", "", accessToken)); }}
              >
                {t("accept")}
              </Button>
              <button onClick={() => setRejecting(true)} disabled={busy} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("reject")}</button>
            </>
          )}
          {role === "buying" && (request.status === "REQUESTED" || request.status === "REJECTED") && (
            <>
              {canEscalate && (
                <Button
                  disabled={busy}
                  onClick={() => { if (window.confirm(t("confirmEscalate"))) act((accessToken) => escalateMarketplaceReturn(order.id, accessToken)); }}
                >
                  {t("escalate")}
                </Button>
              )}
              <button
                disabled={busy} className="text-sm font-semibold text-red-700 underline cursor-pointer"
                onClick={() => { if (window.confirm(t("confirmWithdraw"))) act((accessToken) => withdrawMarketplaceReturn(order.id, accessToken)); }}
              >
                {t("withdraw")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

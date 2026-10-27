"use client";
import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listMyMarketplaceOrders, marketplaceOrderAction, type MarketplaceOrderActionName, type MarketplaceOrderItem } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import RateAndReport from "@/components/RateAndReport";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

type Role = "buying" | "selling";
type OrderAction = MarketplaceOrderActionName;
type ReasonAction = "dispute" | "claim-deposit";

/** Marketplace purchases and sales held in escrow: hand over, confirm receipt, cancel, decline or report a problem. */
export default function MarketplaceOrdersPage() {
  const t = useTranslations("MarketplaceOrdersPage");
  const format = useFormatter();
  const [role, setRole] = useState<Role>("buying");
  const [orders, setOrders] = useState<MarketplaceOrderItem[]>([]);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [disputing, setDisputing] = useState<{ id: string; action: ReasonAction } | null>(null);
  const [reason, setReason] = useState("");

  const fetchOrders = useCallback(async (which: Role) => {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    return listMyMarketplaceOrders(which, token).catch((err: unknown) => err);
  }, []);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchOrders>>) => {
    if (result === null) {
      setState("signedOut");
      return;
    }
    if (result instanceof Error) setError(result.message || t("loadFailed"));
    else setOrders((result as Awaited<ReturnType<typeof listMyMarketplaceOrders>>).results);
    setState("ready");
  }, [t]);

  const load = useCallback(async (which: Role) => apply(await fetchOrders(which)), [apply, fetchOrders]);

  useEffect(() => { fetchOrders(role).then(apply); }, [fetchOrders, apply, role]);

  async function run(orderId: string, action: OrderAction, why?: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setError("");
    try {
      await marketplaceOrderAction(orderId, action, token, why);
      setDisputing(null);
      setReason("");
      await load(role);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  function confirmThen(message: string, orderId: string, action: OrderAction) {
    if (window.confirm(message)) run(orderId, action);
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  // Rental dates are plain calendar days, so they are shown without a time or a timezone shift.
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00`), { dateStyle: "medium" });

  return (
    <AccountSidebarLayout activeHref="/marketplace/orders">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t("title")}</h1>
        <Link href="/marketplace" className="text-sm font-semibold text-[var(--navy)] underline">{t("browse")}</Link>
      </div>

      <div className="flex gap-2 mb-5">
        {(["buying", "selling"] as Role[]).map((value) => (
          <button
            key={value}
            onClick={() => { setRole(value); setState("loading"); setError(""); }}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold cursor-pointer ${role === value ? "bg-[var(--navy)] text-white" : "bg-slate-100 text-slate-700"}`}
          >
            {t(`tab_${value}`)}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      {state === "loading" ? (
        <p className="text-slate-400">...</p>
      ) : state === "signedOut" ? (
        <EmptyState icon="🔒" title={t("signIn")} action={<Button href="/login">{t("signInButton")}</Button>} />
      ) : orders.length === 0 ? (
        <EmptyState icon="📦" title={t(`empty_${role}`)} action={<Button href="/marketplace">{t("browse")}</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  {order.category ? (
                    <Link href={`/marketplace/${order.category}/${order.listing_id}`} className="font-semibold text-[var(--navy)] hover:underline">{order.listing_title}</Link>
                  ) : (
                    <span className="font-semibold text-[var(--navy)]">{order.listing_title}</span>
                  )}
                  <p className="text-sm text-slate-600">
                    {Number(order.amount_xaf).toLocaleString()} XAF · {role === "buying" ? t("seller", { name: order.seller_name }) : t("buyer", { name: order.buyer_name })}
                  </p>
                  {order.deposit_status !== "NONE" || Number(order.deposit_xaf) > 0 ? (
                    <p className="text-sm text-slate-600">{t("depositLine", { amount: Number(order.deposit_xaf).toLocaleString(), status: t(`deposit_${order.deposit_status}`) })}</p>
                  ) : null}
                  {order.rental_starts_on && order.rental_ends_on && (
                    <p className="text-sm text-slate-600">{t("rentalPeriod", { start: day(order.rental_starts_on), end: day(order.rental_ends_on) })}</p>
                  )}
                  <p className="text-xs text-slate-400">{date(order.created_at)}</p>
                </div>
                <Badge variant={order.status === "COMPLETED" ? "green" : order.status === "DISPUTED" ? "gold" : "neutral"}>{t(`status_${order.status}`)}</Badge>
              </div>

              <p className="text-sm text-slate-600 mb-3">
                {order.status === "PAYMENT_PENDING" && t("hintPaymentPending")}
                {order.status === "PAID" && order.seller_deadline && t(role === "buying" ? "hintPaidBuyer" : "hintPaidSeller", { date: date(order.seller_deadline) })}
                {order.status === "HANDED_OVER" && order.auto_release_at && t(role === "buying" ? "hintHandedOverBuyer" : "hintHandedOverSeller", { date: date(order.auto_release_at) })}
                {order.status === "DISPUTED" && t("hintDisputed")}
                {order.status === "COMPLETED" && t("hintCompleted")}
                {order.status === "CANCELLED" && t("hintCancelled")}
                {order.status === "COMPLETED" && order.deposit_status === "HELD" && order.deposit_return_by && ` ${t(role === "buying" ? "hintDepositHeldBuyer" : "hintDepositHeldSeller", { date: day(order.deposit_return_by) })}`}
                {order.deposit_status === "CLAIMED" && ` ${t("hintDepositClaimed")}`}
              </p>

              {disputing?.id === order.id ? (
                <div className="flex flex-col gap-2">
                  <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(disputing.action === "dispute" ? "disputePlaceholder" : "claimPlaceholder")} className="border rounded-lg px-3 py-2 text-sm" />
                  <div className="flex gap-3">
                    <Button onClick={() => run(order.id, disputing.action, reason.trim())} disabled={reason.trim().length < 5}>{t(disputing.action === "dispute" ? "submitDispute" : "submitClaim")}</Button>
                    <button onClick={() => setDisputing(null)} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("close")}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {role === "selling" && order.status === "PAID" && (
                    <>
                      <Button onClick={() => run(order.id, "hand-over")}>{t("handOver")}</Button>
                      <button onClick={() => confirmThen(t("confirmDecline"), order.id, "decline")} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("decline")}</button>
                    </>
                  )}
                  {role === "selling" && order.status === "COMPLETED" && order.deposit_status === "HELD" && (
                    <>
                      <Button onClick={() => confirmThen(t("confirmReturnDeposit"), order.id, "return-deposit")}>{t("returnDeposit")}</Button>
                      <button onClick={() => { setDisputing({ id: order.id, action: "claim-deposit" }); setReason(""); }} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("claimDeposit")}</button>
                    </>
                  )}
                  {role === "buying" && order.status === "HANDED_OVER" && (
                    <Button onClick={() => confirmThen(t("confirmReceipt"), order.id, "confirm")}>{t("confirmReceiptButton")}</Button>
                  )}
                  {role === "buying" && order.status === "PAID" && (
                    <button onClick={() => confirmThen(t("confirmCancel"), order.id, "cancel")} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("cancelOrder")}</button>
                  )}
                  {(order.status === "PAID" || order.status === "HANDED_OVER") && (
                    <button onClick={() => { setDisputing({ id: order.id, action: "dispute" }); setReason(""); }} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("reportProblem")}</button>
                  )}
                </div>
              )}

              {order.status === "COMPLETED" && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <RateAndReport subjectUserId={role === "buying" ? order.seller : order.buyer} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

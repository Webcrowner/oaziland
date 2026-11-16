"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMarketplaceCart, getMyKycStatus, type MarketplaceCart } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import CartGroupCheckout from "@/components/CartGroupCheckout";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";

/** The marketplace cart: items grouped by seller, each seller paid with one Mobile Money payment. */
export default function MarketplaceCartPage() {
  const t = useTranslations("MarketplaceCart");
  const [cart, setCart] = useState<MarketplaceCart | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "error" | "ready">("loading");
  const [kycNeeded, setKycNeeded] = useState(false);
  const [placed, setPlaced] = useState<{ totalXaf: string } | null>(null);
  const [paidSellers, setPaidSellers] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setState("signedOut"));
      return;
    }
    let stale = false;
    getMarketplaceCart(token)
      .then((data) => { if (!stale) { setCart(data); setState("ready"); } })
      .catch(() => { if (!stale) setState("error"); });
    getMyKycStatus(token).then((kyc) => { if (!stale) setKycNeeded(kyc === null); }).catch(() => {});
    return () => { stale = true; };
  }, [reloadKey]);

  const afterPlaced = useCallback((sellerId: string, info: { totalXaf: string }) => {
    setPlaced(info);
    setPaidSellers((ids) => [...ids, sellerId]);
    setReloadKey((key) => key + 1);
  }, []);

  const groups = (cart?.groups ?? []).filter((group) => !paidSellers.includes(group.seller_id));

  return (
    <AccountSidebarLayout activeHref="/marketplace/cart">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t("title")}</h1>
        <Link href="/marketplace" className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--navy)] underline">{t("continueShopping")}</Link>
      </div>

      {placed && (
        <div role="status" className="mb-5 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="mb-1 font-semibold">{t("placedTitle")}</p>
          <p className="mb-2">{t("placedBody", { amount: Number(placed.totalXaf).toLocaleString() })}</p>
          <Link href="/marketplace/orders" className="inline-flex min-h-10 items-center font-semibold text-[var(--navy)] underline">{t("viewOrders")}</Link>
        </div>
      )}

      {state === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : state === "signedOut" ? (
        <EmptyState icon="🔒" title={t("signIn")} action={<Button href="/login">{t("signInButton")}</Button>} />
      ) : state === "error" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{t("loadFailed")}</p>
          <button type="button" onClick={() => { setState("loading"); setReloadKey((key) => key + 1); }} className="min-h-10 font-semibold underline cursor-pointer">{t("retry")}</button>
        </div>
      ) : groups.length === 0 ? (
        placed ? null : <EmptyState icon="🛒" title={t("emptyTitle")} description={t("emptyBody")} action={<Button href="/marketplace?category=goods">{t("browse")}</Button>} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-500" aria-live="polite">{t("itemCount", { count: groups.reduce((sum, group) => sum + group.items.length, 0) })}</p>
          {groups.map((group) => (
            <CartGroupCheckout key={group.seller_id} group={group} kycNeeded={kycNeeded} onCart={setCart} onPlaced={(info) => afterPlaced(group.seller_id, info)} />
          ))}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

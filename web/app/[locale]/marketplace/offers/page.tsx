"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listMyMarketplaceOffers, marketplaceOfferAction, type MarketplaceOfferActionName, type MarketplaceOfferItem } from "@/lib/api";
import { roleFromParam } from "@/lib/notificationLinks";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

type Role = "buying" | "selling";

/** Price offers on marketplace listings: as a seller accept, decline or counter; as a buyer follow, accept a counter-offer, pay or withdraw. */
export default function MarketplaceOffersPage() {
  return (
    <Suspense fallback={null}>
      <MarketplaceOffersContent />
    </Suspense>
  );
}

function MarketplaceOffersContent() {
  const t = useTranslations("MarketplaceOffersPage");
  const to = useTranslations("MarketplaceOffers");
  const format = useFormatter();
  const params = useSearchParams();
  // A notification links here with ?role=selling&offer=<id>: open that tab and bring the offer into view.
  const focusId = params.get("offer");
  const [role, setRole] = useState<Role>(roleFromParam(params.get("role")) ?? "buying");
  const scrolledTo = useRef<string | null>(null);
  const [offers, setOffers] = useState<MarketplaceOfferItem[]>([]);
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [countering, setCountering] = useState<{ id: string; amount: string } | null>(null);

  const fetchOffers = useCallback(async (which: Role) => {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    return listMyMarketplaceOffers(which, token).catch((err: unknown) => err);
  }, []);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchOffers>>) => {
    if (result === null) {
      setState("signedOut");
      return;
    }
    if (result instanceof Error) setError(result.message || t("loadFailed"));
    else setOffers((result as Awaited<ReturnType<typeof listMyMarketplaceOffers>>).results);
    setState("ready");
  }, [t]);

  useEffect(() => { fetchOffers(role).then(apply); }, [fetchOffers, apply, role]);

  useEffect(() => {
    if (state !== "ready" || !focusId || scrolledTo.current === focusId) return;
    const el = document.getElementById(`offer-${focusId}`);
    if (!el) return;
    scrolledTo.current = focusId;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [state, offers, focusId]);

  async function run(offerId: string, action: MarketplaceOfferActionName, amount?: number) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setError("");
    try {
      await marketplaceOfferAction(offerId, action, token, amount);
      setCountering(null);
      apply(await fetchOffers(role));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  const money = (value: string | number) => `${Number(value).toLocaleString()} XAF`;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  return (
    <AccountSidebarLayout activeHref="/marketplace/offers">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t("title")}</h1>
        <Link href="/marketplace/orders" className="text-sm font-semibold text-[var(--navy)] underline">{t("orders")}</Link>
      </div>

      <div className="flex gap-2 mb-5">
        {(["buying", "selling"] as Role[]).map((value) => (
          <button
            key={value}
            onClick={() => { setRole(value); setState("loading"); setError(""); setCountering(null); }}
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
      ) : offers.length === 0 ? (
        <EmptyState icon="🤝" title={t(`empty_${role}`)} action={<Button href="/marketplace">{t("browse")}</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          {offers.map((offer) => {
            const listingHref = offer.category ? `/marketplace/${offer.category}/${offer.listing_id}` : null;
            const waiting = offer.status === "PENDING" || offer.status === "COUNTERED";
            return (
              <div
                key={offer.id}
                id={`offer-${offer.id}`}
                className={`rounded-2xl border bg-white p-4 scroll-mt-24 ${offer.id === focusId ? "border-amber-400 ring-2 ring-amber-300" : "border-slate-200"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    {offer.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={offer.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                    )}
                    <div className="min-w-0">
                      {listingHref ? (
                        <Link href={listingHref} className="font-semibold text-[var(--navy)] hover:underline">{offer.listing_title}</Link>
                      ) : (
                        <span className="font-semibold text-[var(--navy)]">{offer.listing_title}</span>
                      )}
                      <p className="text-sm text-slate-600">{t("asking", { price: money(offer.listing_price_xaf) })}</p>
                      <p className="text-sm text-slate-600">
                        {role === "buying" ? t("seller", { name: offer.seller_name }) : t("buyer", { name: offer.buyer_name })}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{t("offered", { price: money(offer.amount_xaf) })}</p>
                      {offer.counter_amount_xaf && <p className="text-sm font-semibold text-slate-800">{t("countered", { price: money(offer.counter_amount_xaf) })}</p>}
                      {offer.message && <p className="mt-1 text-sm italic text-slate-500">“{offer.message}”</p>}
                      <p className="text-xs text-slate-400">{date(offer.created_at)}</p>
                    </div>
                  </div>
                  <Badge variant={offer.status === "PAID" || offer.status === "ACCEPTED" ? "green" : "neutral"}>{to(`status_${offer.status}`)}</Badge>
                </div>

                {waiting && offer.respond_by && <p className="mt-2 text-xs text-slate-500">{to("respondBy", { date: date(offer.respond_by) })}</p>}
                {offer.status === "ACCEPTED" && offer.pay_by && (
                  <p className="mt-2 text-sm text-slate-600">
                    {role === "buying"
                      ? t("hintAcceptedBuyer", { price: money(offer.agreed_amount_xaf ?? offer.amount_xaf), date: date(offer.pay_by) })
                      : t("hintAcceptedSeller", { price: money(offer.agreed_amount_xaf ?? offer.amount_xaf), date: date(offer.pay_by) })}
                  </p>
                )}

                {countering?.id === offer.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                      type="number" inputMode="numeric" step={1}
                      min={Number(offer.amount_xaf) + 1} max={Number(offer.listing_price_xaf) - 1}
                      value={countering.amount} onChange={(e) => setCountering({ id: offer.id, amount: e.target.value })}
                      placeholder={t("counterPlaceholder")} aria-label={t("counterPlaceholder")}
                      className="w-44 border rounded-lg px-3 py-2 text-sm"
                    />
                    <Button onClick={() => run(offer.id, "counter", Number(countering.amount))} disabled={!(Number(countering.amount) > Number(offer.amount_xaf) && Number(countering.amount) < Number(offer.listing_price_xaf))}>{t("sendCounter")}</Button>
                    <button onClick={() => setCountering(null)} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("close")}</button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {role === "selling" && offer.status === "PENDING" && (
                      <>
                        <Button onClick={() => run(offer.id, "accept")}>{t("accept")}</Button>
                        <button onClick={() => setCountering({ id: offer.id, amount: "" })} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("counter")}</button>
                        <button onClick={() => { if (window.confirm(t("confirmDecline"))) run(offer.id, "decline"); }} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("decline")}</button>
                      </>
                    )}
                    {role === "selling" && offer.status === "COUNTERED" && (
                      <button onClick={() => { if (window.confirm(t("confirmDecline"))) run(offer.id, "decline"); }} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("decline")}</button>
                    )}
                    {role === "buying" && offer.status === "COUNTERED" && (
                      <Button onClick={() => run(offer.id, "accept")}>{t("acceptCounter", { price: money(offer.counter_amount_xaf ?? 0) })}</Button>
                    )}
                    {role === "buying" && offer.status === "ACCEPTED" && listingHref && (
                      <Button href={listingHref}>{t("payNow")}</Button>
                    )}
                    {role === "buying" && (waiting || offer.status === "ACCEPTED") && (
                      <button onClick={() => { if (window.confirm(to("confirmWithdraw"))) run(offer.id, "withdraw"); }} className="text-sm font-semibold text-red-700 underline cursor-pointer">
                        {offer.status === "COUNTERED" ? to("declineCounter") : to("withdraw")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

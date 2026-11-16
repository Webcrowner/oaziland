"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  createMarketplaceCoupon, deleteMarketplaceCoupon, getMyMarketplaceShop, getMyProfile, listMarketplaceCoupons,
  updateMarketplaceCoupon, updateMyMarketplaceShop,
  type MarketplaceCoupon, type MarketplaceCouponKind, type MarketplaceShopSettings,
} from "@/lib/api";
import { couponDiscount, couponStatus, normalizeCouponCode } from "@/lib/coupons";
import { localInputToIso } from "@/lib/flashSale";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import MediaUploader from "@/components/MediaUploader";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

const input = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white";
const card = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-5";
const heading = "mb-1 text-base font-bold text-[var(--navy)]";

const EMPTY_SHOP: MarketplaceShopSettings = {
  name: "", tagline: "", description: "", logo_url: "", banner_url: "", shipping_policy: "", return_policy: "",
  announcement: "", on_vacation: false, vacation_message: "", vacation_until: null,
};

interface CouponDraft {
  code: string; kind: MarketplaceCouponKind; value: string; minOrder: string; maxUses: string; startsAt: string; expiresAt: string;
}
const EMPTY_COUPON: CouponDraft = { code: "", kind: "PERCENT", value: "", minOrder: "", maxUses: "", startsAt: "", expiresAt: "" };

function ImageField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (url: string) => void }) {
  const t = useTranslations("ShopSettings");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt={t("previewAlt", { label })} className="h-24 w-full max-w-sm rounded-xl border border-slate-200 object-cover" />
      ) : (
        <p className="text-xs text-slate-500">{hint}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <MediaUploader
          folder="marketplace" multiple={false} accept="image/*" onUploaded={(result) => onChange(result.url)}
          label={value ? t("changeImage") : t("uploadImage")}
          triggerClassName="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-[var(--navy)] px-4 text-sm font-semibold text-[var(--navy)] hover:bg-gray-50"
        />
        {value && <button type="button" onClick={() => onChange("")} className="min-h-10 text-sm font-semibold text-red-700 underline cursor-pointer">{t("removeImage")}</button>}
      </div>
    </div>
  );
}

/** The seller's shop settings: branding, policies, vacation mode, discount codes and a pointer to staff access. */
export default function ShopSettingsPage() {
  const t = useTranslations("ShopSettings");
  const format = useFormatter();
  const [state, setState] = useState<"loading" | "signedOut" | "error" | "ready">("loading");
  const [userId, setUserId] = useState("");
  const [shop, setShop] = useState<MarketplaceShopSettings>(EMPTY_SHOP);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [coupons, setCoupons] = useState<MarketplaceCoupon[]>([]);
  const [couponDraft, setCouponDraft] = useState<CouponDraft>(EMPTY_COUPON);
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      void Promise.resolve().then(() => setState("signedOut"));
      return;
    }
    let stale = false;
    Promise.all([getMyProfile(token), getMyMarketplaceShop(token), listMarketplaceCoupons(token).catch(() => [] as MarketplaceCoupon[])])
      .then(([profile, settings, couponList]) => {
        if (stale) return;
        setUserId(profile.id);
        setShop({ ...EMPTY_SHOP, ...settings });
        setCoupons(couponList);
        setState("ready");
      })
      .catch(() => { if (!stale) setState("error"); });
    return () => { stale = true; };
  }, [reloadKey]);

  const set = (patch: Partial<MarketplaceShopSettings>) => {
    setShop((current) => ({ ...current, ...patch }));
    setSaveState("idle");
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setSaving(true);
    setSaveState("idle");
    try {
      setShop({ ...EMPTY_SHOP, ...(await updateMyMarketplaceShop({ ...shop, vacation_until: shop.on_vacation && shop.vacation_until ? shop.vacation_until : null }, token)) });
      setSaveState("saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("saveFailed"));
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }

  async function runCoupon(action: (token: string) => Promise<unknown>) {
    const token = localStorage.getItem("access_token");
    if (!token) return false;
    setCouponBusy(true);
    setCouponError("");
    try {
      await action(token);
      setCoupons(await listMarketplaceCoupons(token));
      return true;
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : t("couponActionFailed"));
      return false;
    } finally {
      setCouponBusy(false);
    }
  }

  async function createCoupon(e: React.FormEvent) {
    e.preventDefault();
    const d = couponDraft;
    const created = await runCoupon((token) => createMarketplaceCoupon({
      code: d.code, kind: d.kind, value: d.value, min_order_xaf: d.minOrder || "0", max_uses: d.maxUses ? Number(d.maxUses) : null,
      starts_at: localInputToIso(d.startsAt), expires_at: localInputToIso(d.expiresAt), is_active: true,
    }, token));
    if (created) setCouponDraft(EMPTY_COUPON);
  }

  function removeCoupon(coupon: MarketplaceCoupon) {
    if (window.confirm(t("confirmDeleteCoupon", { code: coupon.code }))) void runCoupon((token) => deleteMarketplaceCoupon(coupon.id, token));
  }

  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const money = (value: string | number) => format.number(Number(value));

  return (
    <AccountSidebarLayout activeHref="/marketplace/shop-settings">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-x-4">
          {userId && <Link href={`/marketplace/shop/${userId}`} className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--navy)] underline">{t("viewPublicShop")}</Link>}
          <Link href="/marketplace/my-listings" className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--navy)] underline">{t("myListings")}</Link>
        </div>
      </div>

      {state === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      ) : state === "signedOut" ? (
        <EmptyState icon="🔒" title={t("signIn")} action={<Button href="/login">{t("signInButton")}</Button>} />
      ) : state === "error" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{t("loadFailed")}</p>
          <button type="button" onClick={() => { setState("loading"); setReloadKey((key) => key + 1); }} className="min-h-10 font-semibold underline cursor-pointer">{t("retry")}</button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <form onSubmit={save} className="flex flex-col gap-5">
            <section className={card} aria-labelledby="shop-profile">
              <h2 id="shop-profile" className={heading}>{t("profileTitle")}</h2>
              <p className="mb-3 text-sm text-slate-500">{t("profileHelp")}</p>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("name")}
                  <input value={shop.name} maxLength={80} required onChange={(e) => set({ name: e.target.value })} className={`${input} font-normal`} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("tagline")}
                  <input value={shop.tagline} maxLength={140} onChange={(e) => set({ tagline: e.target.value })} placeholder={t("taglinePlaceholder")} className={`${input} font-normal`} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("description")}
                  <textarea value={shop.description} rows={4} onChange={(e) => set({ description: e.target.value })} className={`${input} font-normal`} />
                </label>
                <ImageField label={t("logo")} hint={t("logoHint")} value={shop.logo_url} onChange={(url) => set({ logo_url: url })} />
                <ImageField label={t("banner")} hint={t("bannerHint")} value={shop.banner_url} onChange={(url) => set({ banner_url: url })} />
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("announcement")}
                  <input value={shop.announcement} maxLength={200} onChange={(e) => set({ announcement: e.target.value })} placeholder={t("announcementPlaceholder")} className={`${input} font-normal`} />
                </label>
              </div>
            </section>

            <section className={card} aria-labelledby="shop-policies">
              <h2 id="shop-policies" className={heading}>{t("policiesTitle")}</h2>
              <p className="mb-3 text-sm text-slate-500">{t("policiesHelp")}</p>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("shippingPolicy")}
                  <textarea value={shop.shipping_policy} rows={4} onChange={(e) => set({ shipping_policy: e.target.value })} placeholder={t("shippingPolicyPlaceholder")} className={`${input} font-normal`} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("returnPolicy")}
                  <textarea value={shop.return_policy} rows={4} onChange={(e) => set({ return_policy: e.target.value })} placeholder={t("returnPolicyPlaceholder")} className={`${input} font-normal`} />
                </label>
              </div>
            </section>

            <section className={card} aria-labelledby="shop-vacation">
              <h2 id="shop-vacation" className={heading}>{t("vacationTitle")}</h2>
              <p className="mb-3 text-sm text-slate-500">{t("vacationHelp")}</p>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox" role="switch" checked={shop.on_vacation} onChange={(e) => set({ on_vacation: e.target.checked })}
                  className="h-5 w-5 shrink-0"
                />
                {t("vacationSwitch")}
              </label>
              {shop.on_vacation && (
                <div className="mt-3 flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                    {t("vacationUntil")}
                    <input type="date" value={shop.vacation_until ?? ""} onChange={(e) => set({ vacation_until: e.target.value || null })} className={`${input} font-normal sm:max-w-xs`} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                    {t("vacationMessage")}
                    <input value={shop.vacation_message} maxLength={200} onChange={(e) => set({ vacation_message: e.target.value })} placeholder={t("vacationMessagePlaceholder")} className={`${input} font-normal`} />
                  </label>
                </div>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving} className="w-full sm:w-auto">{saving ? t("saving") : t("save")}</Button>
              {saveState === "saved" && <p role="status" className="text-sm font-semibold text-green-700">{t("saved")}</p>}
              {saveState === "error" && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
            </div>
          </form>

          <section className={card} aria-labelledby="shop-coupons">
            <h2 id="shop-coupons" className={heading}>{t("couponsTitle")}</h2>
            <p className="mb-3 text-sm text-slate-500">{t("couponsHelp")}</p>

            {coupons.length === 0 ? (
              <p className="mb-4 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">{t("noCoupons")}</p>
            ) : (
              <ul className="mb-4 flex flex-col gap-2">
                {coupons.map((coupon) => {
                  const status = couponStatus(coupon);
                  const discount = couponDiscount(coupon);
                  return (
                    <li key={coupon.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="break-all text-base font-black tracking-wide text-[var(--navy)]">{coupon.code}</p>
                        <Badge variant={status === "active" ? "green" : "neutral"}>{t(`status_${status}`)}</Badge>
                      </div>
                      <p className="mt-1 font-semibold text-slate-800">
                        {discount.kind === "PERCENT" ? t("percentOff", { value: discount.amount }) : t("fixedOff", { value: money(discount.amount) })}
                        {Number(coupon.min_order_xaf) > 0 && <span className="font-normal text-slate-600"> · {t("minOrder", { value: money(coupon.min_order_xaf) })}</span>}
                      </p>
                      <p className="text-slate-600">
                        {coupon.max_uses !== null ? t("usesOfMax", { uses: coupon.uses, max: coupon.max_uses }) : t("usesUnlimited", { uses: coupon.uses })}
                        {" · "}
                        {[
                          status === "scheduled" && coupon.starts_at ? t("validFrom", { date: day(coupon.starts_at) }) : "",
                          coupon.expires_at ? t("validUntil", { date: day(coupon.expires_at) }) : t("noExpiry"),
                        ].filter(Boolean).join(" ")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4">
                        <button
                          type="button" disabled={couponBusy} onClick={() => runCoupon((token) => updateMarketplaceCoupon(coupon.id, { is_active: !coupon.is_active }, token))}
                          aria-pressed={coupon.is_active}
                          className="min-h-10 font-semibold text-[var(--navy)] underline disabled:opacity-50 cursor-pointer"
                        >
                          {coupon.is_active ? t("deactivate") : t("activate")}
                        </button>
                        <button type="button" disabled={couponBusy} onClick={() => removeCoupon(coupon)} className="min-h-10 font-semibold text-red-700 underline disabled:opacity-50 cursor-pointer">{t("delete")}</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <form onSubmit={createCoupon} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3 sm:p-4">
              <h3 className="text-sm font-bold text-slate-800">{t("newCoupon")}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("couponCode")}
                  <input
                    value={couponDraft.code} onChange={(e) => setCouponDraft({ ...couponDraft, code: normalizeCouponCode(e.target.value) })}
                    required minLength={3} maxLength={30} autoCapitalize="characters" placeholder="SUMMER10" className={`${input} font-normal uppercase`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("couponKind")}
                  <select value={couponDraft.kind} onChange={(e) => setCouponDraft({ ...couponDraft, kind: e.target.value as MarketplaceCouponKind })} className={`${input} font-normal`}>
                    <option value="PERCENT">{t("kindPercent")}</option>
                    <option value="FIXED">{t("kindFixed")}</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {couponDraft.kind === "PERCENT" ? t("valuePercent") : t("valueFixed")}
                  <input
                    type="number" inputMode="numeric" required step="1" min="1" max={couponDraft.kind === "PERCENT" ? 90 : undefined}
                    value={couponDraft.value} onChange={(e) => setCouponDraft({ ...couponDraft, value: e.target.value })} className={`${input} font-normal`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("minOrderLabel")}
                  <input type="number" inputMode="numeric" min="0" step="1" value={couponDraft.minOrder} onChange={(e) => setCouponDraft({ ...couponDraft, minOrder: e.target.value })} className={`${input} font-normal`} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("maxUsesLabel")}
                  <input type="number" inputMode="numeric" min="1" step="1" value={couponDraft.maxUses} onChange={(e) => setCouponDraft({ ...couponDraft, maxUses: e.target.value })} placeholder={t("unlimited")} className={`${input} font-normal`} />
                </label>
                <span className="hidden sm:block" />
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("startsAt")}
                  <input type="datetime-local" value={couponDraft.startsAt} onChange={(e) => setCouponDraft({ ...couponDraft, startsAt: e.target.value })} className={`${input} font-normal`} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                  {t("expiresAt")}
                  <input type="datetime-local" value={couponDraft.expiresAt} onChange={(e) => setCouponDraft({ ...couponDraft, expiresAt: e.target.value })} className={`${input} font-normal`} />
                </label>
              </div>
              {couponError && <p role="alert" className="text-sm text-red-700">{couponError}</p>}
              <Button type="submit" disabled={couponBusy} className="w-full sm:w-auto sm:self-start">{couponBusy ? t("creating") : t("createCoupon")}</Button>
            </form>
          </section>

          <section className={card} aria-labelledby="shop-team">
            <h2 id="shop-team" className={heading}>{t("teamTitle")}</h2>
            <p className="mb-3 text-sm text-slate-500">{t("teamHelp")}</p>
            <Button href="/staff-access" variant="secondary" className="w-full sm:w-auto">{t("teamLink")}</Button>
          </section>
        </div>
      )}
    </AccountSidebarLayout>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMyMarketplaceListings, updateMarketplaceListing, setMarketplaceListingStatus, deleteMarketplaceListing, listQuarters,
  renewMarketplaceListing, type ListingStats, type MarketplaceCategory, type MarketplaceAvailability, type Quarter, type VehicleSpec, type GoodsCategory, type GoodsCondition, type GoodsVariant,
  GOODS_CATEGORIES, GOODS_CONDITIONS,
} from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import { isoToLocalInput, localInputToIso } from "@/lib/flashSale";
import CompareAtPrice from "@/components/CompareAtPrice";
import MarketplaceVariantEditor from "@/components/MarketplaceVariantEditor";
import MarketplaceBoostPanel from "@/components/MarketplaceBoostPanel";
import QuarterOptions from "@/components/QuarterOptions";
import MarketplaceConditionsFields, {
  EMPTY_CONDITIONS, conditionsChanged, loadConditionsDraft, saveConditions, type ConditionsDraft,
} from "@/components/MarketplaceConditionsFields";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

const CATEGORIES: MarketplaceCategory[] = ["goods", "cars", "stores", "warehouses", "businesses"];
const STATUSES: MarketplaceAvailability[] = ["AVAILABLE", "UNDER_OFFER", "UNAVAILABLE"];

const PRICE_BASES = ["SALE", "RENT_MONTHLY", "RENT_WEEKLY", "RENT_NIGHTLY", "RENT_ANNUAL"] as const;

interface MyListing {
  id: string;
  title: string;
  description: string;
  price_xaf: string;
  price_basis: string;
  security_deposit_xaf: string;
  quarter: string | null;
  availability_status: MarketplaceAvailability;
  removed_by_moderation: boolean;
  size_sqm?: string | null;
  frontage_meters?: string | null;
  seating_capacity?: number | null;
  includes_goodwill?: boolean;
  includes_inventory?: boolean;
  annual_revenue_xaf?: string | null;
  vehicle_spec?: VehicleSpec;
  item_category?: GoodsCategory;
  condition?: GoodsCondition;
  quantity?: number;
  stats?: ListingStats;
  expires_at?: string;
  is_expired?: boolean;
  allow_offers?: boolean;
  is_boosted?: boolean;
  boosted_until?: string | null;
  sale_price_xaf?: string | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  on_sale?: boolean;
  compare_at_price_xaf?: string | null;
  has_variants?: boolean;
  price_from_xaf?: string | null;
  variants?: GoodsVariant[];
}

interface Draft {
  title: string; description: string; price: string; priceBasis: string; quarter: string; deposit: string;
  sizeSqm: string; frontage: string; seating: string; revenue: string;
  goodwill: boolean; inventory: boolean;
  make: string; model: string; year: string; mileage: string; engine: string;
  itemCategory: string; condition: string; quantity: string;
  compareAt: string; hasVariants: boolean;
  allowOffers: boolean;
  salePrice: string; saleStart: string; saleEnd: string;
}

const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function draftFrom(listing: MyListing): Draft {
  const spec = listing.vehicle_spec;
  return {
    title: listing.title, description: listing.description, price: String(Number(listing.price_xaf)),
    priceBasis: listing.price_basis, quarter: listing.quarter ?? "", deposit: String(Number(listing.security_deposit_xaf ?? 0)),
    sizeSqm: text(listing.size_sqm), frontage: text(listing.frontage_meters), seating: text(listing.seating_capacity),
    revenue: text(listing.annual_revenue_xaf), goodwill: Boolean(listing.includes_goodwill), inventory: Boolean(listing.includes_inventory),
    make: text(spec?.make), model: text(spec?.model), year: text(spec?.year), mileage: text(spec?.mileage_km), engine: text(spec?.engine_size_cc),
    itemCategory: text(listing.item_category), condition: text(listing.condition), quantity: text(listing.quantity),
    compareAt: listing.compare_at_price_xaf ? String(Number(listing.compare_at_price_xaf)) : "", hasVariants: Boolean(listing.has_variants),
    allowOffers: listing.allow_offers ?? true,
    salePrice: listing.sale_price_xaf ? String(Number(listing.sale_price_xaf)) : "",
    saleStart: isoToLocalInput(listing.sale_starts_at), saleEnd: isoToLocalInput(listing.sale_ends_at),
  };
}

const saleChanged = (a: Draft, b: Draft) => a.salePrice !== b.salePrice || a.saleStart !== b.saleStart || a.saleEnd !== b.saleEnd;

/** All three fields null clears the sale. */
function salePayload(d: Draft): Record<string, unknown> {
  if (!d.salePrice) return { sale_price_xaf: null, sale_starts_at: null, sale_ends_at: null };
  return { sale_price_xaf: d.salePrice, sale_starts_at: localInputToIso(d.saleStart), sale_ends_at: localInputToIso(d.saleEnd) };
}

/** Only the fields that exist for this category; blank optional numbers are sent as null so they can be cleared. */
function payloadFrom(category: MarketplaceCategory, d: Draft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: d.title, description: d.description, price_xaf: d.price, price_basis: d.priceBasis, quarter: d.quarter || null,
    // A deposit only exists for rentals; switching a listing to a sale clears it.
    security_deposit_xaf: d.priceBasis === "SALE" ? "0" : d.deposit || "0",
    allow_offers: d.allowOffers,
  };
  if (category === "warehouses") payload.size_sqm = d.sizeSqm;
  if (category === "stores") {
    payload.size_sqm = d.sizeSqm;
    payload.frontage_meters = d.frontage || null;
  }
  if (category === "businesses") {
    payload.size_sqm = d.sizeSqm || null;
    payload.seating_capacity = d.seating ? Number(d.seating) : null;
    payload.annual_revenue_xaf = d.revenue || null;
    payload.includes_goodwill = d.goodwill;
    payload.includes_inventory = d.inventory;
  }
  if (category === "goods") {
    payload.item_category = d.itemCategory;
    payload.condition = d.condition;
    payload.compare_at_price_xaf = d.compareAt || null;
    // With options the stock is the total of the versions and the server refuses to change it directly.
    if (!d.hasVariants) payload.quantity = Number(d.quantity) || 1;
  }
  if (category === "cars") {
    payload.vehicle_spec = {
      make: d.make, model: d.model, year: Number(d.year),
      mileage_km: d.mileage ? Number(d.mileage) : null, engine_size_cc: d.engine ? Number(d.engine) : null,
    };
  }
  return payload;
}

/** The lister's own marketplace listings across all four categories: edit, pause or mark sold, and delete. */
export default function MyMarketplaceListingsPage() {
  const t = useTranslations("MyMarketplaceListingsPage");
  const tf = useTranslations("FlashSale");
  const tg = useTranslations("MarketplaceGoods");
  const [rows, setRows] = useState<Record<MarketplaceCategory, MyListing[]>>({ warehouses: [], stores: [], businesses: [], cars: [], goods: [] });
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conditions, setConditions] = useState<ConditionsDraft>(EMPTY_CONDITIONS);
  // null until the listing's saved conditions have loaded, so an unloaded editor can never overwrite them.
  const [savedConditions, setSavedConditions] = useState<ConditionsDraft | null>(null);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [boostingId, setBoostingId] = useState<string | null>(null);
  const [saleError, setSaleError] = useState("");

  useEffect(() => {
    listQuarters().then(setQuarters).catch(() => {});
  }, []);

  const fetchRows = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return null;
    return Promise.all(
      CATEGORIES.map((category) => listMyMarketplaceListings<MyListing>(category, token).then((data) => data.results).catch(() => [] as MyListing[])),
    );
  }, []);

  const applyRows = useCallback((results: MyListing[][] | null) => {
    if (results === null) {
      setState("signedOut");
      return;
    }
    setRows(Object.fromEntries(CATEGORIES.map((category, i) => [category, results[i]])) as Record<MarketplaceCategory, MyListing[]>);
    setState("ready");
  }, []);

  const load = useCallback(async () => applyRows((await fetchRows()) ?? null), [fetchRows, applyRows]);

  useEffect(() => {
    const pending = fetchRows();
    if (pending) pending.then(applyRows);
    else Promise.resolve().then(() => applyRows(null));
  }, [fetchRows, applyRows]);

  async function run(action: (token: string) => Promise<unknown>): Promise<boolean> {
    const token = localStorage.getItem("access_token");
    if (!token) return false;
    setError("");
    try {
      await action(token);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
      return false;
    }
  }

  async function startEdit(category: MarketplaceCategory, listing: MyListing) {
    setEditingId(listing.id);
    setDraft(draftFrom(listing));
    setSaleError("");
    setConditions(EMPTY_CONDITIONS);
    setSavedConditions(null);
    const loaded = await loadConditionsDraft(category, listing.id).catch(() => null);
    if (!loaded) return;
    setConditions(loaded);
    setSavedConditions(loaded);
  }

  async function saveSale(id: string, d: Draft): Promise<boolean> {
    const token = localStorage.getItem("access_token");
    if (!token) return false;
    setSaleError("");
    try {
      await updateMarketplaceListing("goods", id, salePayload(d), token);
      await load();
      return true;
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : t("saleFailed"));
      return false;
    }
  }

  async function clearSale(listing: MyListing) {
    if (!draft) return;
    const cleared = { ...draft, salePrice: "", saleStart: "", saleEnd: "" };
    setDraft(cleared);
    setSaleError("");
    if (listing.sale_price_xaf) await saveSale(listing.id, cleared);
  }

  async function saveEdit(category: MarketplaceCategory, id: string) {
    if (!draft) return;
    const original = category === "goods" ? rows.goods.find((row) => row.id === id) : undefined;
    if (category === "goods" && draft.compareAt !== "" && !(Number(draft.compareAt) > Number(draft.price))) {
      setError(t("compareAtInvalid"));
      return;
    }
    const sale = original ? saleChanged(draftFrom(original), draft) : false;
    if (sale && draft.salePrice && !draft.saleEnd) {
      setSaleError(t("saleEndRequired"));
      return;
    }
    // Stay in the editor on failure so the lister can correct the rejected value.
    if (!(await run((token) => updateMarketplaceListing(category, id, payloadFrom(category, draft), token)))) return;
    if (sale && !(await saveSale(id, draft))) return;
    // Conditions are only sent when changed: they are locked while an order is active, and unchanged ones must not trip that.
    if (savedConditions && conditionsChanged(category, savedConditions, conditions)) {
      if (!(await run((token) => saveConditions(category, id, conditions, token)))) return;
    }
    setEditingId(null);
  }

  function confirmDelete(category: MarketplaceCategory, id: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    run((token) => deleteMarketplaceListing(category, id, token));
  }

  const total = CATEGORIES.reduce((sum, category) => sum + rows[category].length, 0);

  return (
    <AccountSidebarLayout activeHref="/marketplace/my-listings">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/marketplace/shop-settings" className="inline-flex min-h-10 items-center text-sm font-semibold text-[var(--navy)] underline">{t("myShop")}</Link>
          <Link href="/marketplace/dashboard" className="text-sm font-semibold text-[var(--navy)] underline">{t("sellerDashboard")}</Link>
          <Link href="/marketplace/offers" className="text-sm font-semibold text-[var(--navy)] underline">{t("viewOffers")}</Link>
          <Link href="/marketplace/sell" className="text-sm font-semibold text-[var(--navy)] underline">{t("postNew")}</Link>
        </div>
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      {state === "loading" ? (
        <p className="text-slate-400">...</p>
      ) : state === "signedOut" ? (
        <EmptyState icon="🔒" title={t("signIn")} action={<Button href="/login">{t("signInButton")}</Button>} />
      ) : total === 0 ? (
        <EmptyState icon="🏷️" title={t("empty")} action={<Button href="/marketplace/sell">{t("postNew")}</Button>} />
      ) : (
        <div className="flex flex-col gap-8">
          {CATEGORIES.filter((category) => rows[category].length > 0).map((category) => (
            <section key={category}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-3">{t(`category_${category}`)}</h2>
              <div className="flex flex-col gap-3">
                {rows[category].map((listing) => (
                  <div key={listing.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    {editingId === listing.id && draft ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} aria-label={t("fieldTitle")} className="border rounded-lg px-3 py-2 text-sm md:col-span-2" />
                        <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label={t("fieldDescription")} className="border rounded-lg px-3 py-2 text-sm md:col-span-2" />
                        <input type="number" min="0.01" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} aria-label={t("fieldPrice")} placeholder={t("fieldPrice")} className="border rounded-lg px-3 py-2 text-sm" />
                        {category !== "goods" && (
                          <select value={draft.priceBasis} onChange={(e) => setDraft({ ...draft, priceBasis: e.target.value })} aria-label={t("fieldPriceBasis")} className="border rounded-lg px-3 py-2 text-sm">
                            {PRICE_BASES.map((basis) => <option key={basis} value={basis}>{t(`basis_${basis}`)}</option>)}
                          </select>
                        )}
                        {draft.priceBasis !== "SALE" && (
                          <input type="number" min="0" step="0.01" value={draft.deposit} onChange={(e) => setDraft({ ...draft, deposit: e.target.value })} aria-label={t("fieldDeposit")} placeholder={t("fieldDeposit")} className="border rounded-lg px-3 py-2 text-sm md:col-span-2" />
                        )}
                        <select value={draft.quarter} onChange={(e) => setDraft({ ...draft, quarter: e.target.value })} aria-label={t("fieldNeighborhood")} className="border rounded-lg px-3 py-2 text-sm md:col-span-2">
                          <option value="">{t("noNeighborhood")}</option>
                          <QuarterOptions quarters={quarters} />
                        </select>
                        {category !== "cars" && category !== "goods" && (
                          <input type="number" min="0.01" step="0.01" value={draft.sizeSqm} onChange={(e) => setDraft({ ...draft, sizeSqm: e.target.value })} required={category !== "businesses"} aria-label={t("fieldSize")} placeholder={t("fieldSize")} className="border rounded-lg px-3 py-2 text-sm" />
                        )}
                        {category === "stores" && (
                          <input type="number" min="0.01" step="0.01" value={draft.frontage} onChange={(e) => setDraft({ ...draft, frontage: e.target.value })} aria-label={t("fieldFrontage")} placeholder={t("fieldFrontage")} className="border rounded-lg px-3 py-2 text-sm" />
                        )}
                        {category === "businesses" && (
                          <>
                            <input type="number" min="1" step="1" value={draft.seating} onChange={(e) => setDraft({ ...draft, seating: e.target.value })} aria-label={t("fieldSeating")} placeholder={t("fieldSeating")} className="border rounded-lg px-3 py-2 text-sm" />
                            <input type="number" min="0" step="0.01" value={draft.revenue} onChange={(e) => setDraft({ ...draft, revenue: e.target.value })} aria-label={t("fieldRevenue")} placeholder={t("fieldRevenue")} className="border rounded-lg px-3 py-2 text-sm" />
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.goodwill} onChange={(e) => setDraft({ ...draft, goodwill: e.target.checked })} /> {t("fieldGoodwill")}</label>
                            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.inventory} onChange={(e) => setDraft({ ...draft, inventory: e.target.checked })} /> {t("fieldInventory")}</label>
                          </>
                        )}
                        {category === "cars" && (
                          <>
                            <input value={draft.make} onChange={(e) => setDraft({ ...draft, make: e.target.value })} required aria-label={t("fieldMake")} placeholder={t("fieldMake")} className="border rounded-lg px-3 py-2 text-sm" />
                            <input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} required aria-label={t("fieldModel")} placeholder={t("fieldModel")} className="border rounded-lg px-3 py-2 text-sm" />
                            <input type="number" min="1886" step="1" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })} required aria-label={t("fieldYear")} placeholder={t("fieldYear")} className="border rounded-lg px-3 py-2 text-sm" />
                            <input type="number" min="0" step="1" value={draft.mileage} onChange={(e) => setDraft({ ...draft, mileage: e.target.value })} aria-label={t("fieldMileage")} placeholder={t("fieldMileage")} className="border rounded-lg px-3 py-2 text-sm" />
                            <input type="number" min="1" step="1" value={draft.engine} onChange={(e) => setDraft({ ...draft, engine: e.target.value })} aria-label={t("fieldEngine")} placeholder={t("fieldEngine")} className="border rounded-lg px-3 py-2 text-sm" />
                          </>
                        )}
                        {category === "goods" && (
                          <>
                            <select value={draft.itemCategory} onChange={(e) => setDraft({ ...draft, itemCategory: e.target.value })} aria-label={t("fieldItemCategory")} className="border rounded-lg px-3 py-2 text-sm">
                              {GOODS_CATEGORIES.map((c) => <option key={c} value={c}>{tg(`cat_${c}`)}</option>)}
                            </select>
                            <select value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value })} aria-label={t("fieldCondition")} className="border rounded-lg px-3 py-2 text-sm">
                              {GOODS_CONDITIONS.map((c) => <option key={c} value={c}>{tg(`cond_${c}`)}</option>)}
                            </select>
                            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                              {t("fieldQuantity")}
                              <input
                                type="number" min="1" max="100000" step="1" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                                required={!draft.hasVariants} disabled={draft.hasVariants} aria-describedby={draft.hasVariants ? `qty-note-${listing.id}` : undefined}
                                placeholder={t("fieldQuantity")} className="border rounded-lg px-3 py-2 text-sm font-normal disabled:bg-slate-100 disabled:text-slate-500"
                              />
                              {draft.hasVariants && <span id={`qty-note-${listing.id}`} className="font-normal text-slate-500">{t("quantityFromOptions")}</span>}
                            </label>
                            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                              {t("fieldCompareAt")}
                              <input
                                type="number" inputMode="numeric" min="1" step="any" value={draft.compareAt} onChange={(e) => setDraft({ ...draft, compareAt: e.target.value })}
                                aria-invalid={draft.compareAt !== "" && !(Number(draft.compareAt) > Number(draft.price))}
                                className="border rounded-lg px-3 py-2 text-sm font-normal"
                              />
                              <span className={`font-normal ${draft.compareAt !== "" && !(Number(draft.compareAt) > Number(draft.price)) ? "text-red-700" : "text-slate-500"}`}>
                                {draft.compareAt !== "" && !(Number(draft.compareAt) > Number(draft.price)) ? t("compareAtInvalid") : t("compareAtHint")}
                              </span>
                            </label>
                            <div className="md:col-span-2">
                              <MarketplaceVariantEditor
                                listingId={listing.id} basePriceXaf={Number(draft.price) || 0}
                                onSaved={(result) => {
                                  setDraft((current) => (current ? { ...current, hasVariants: result.variants.length > 0, quantity: String(result.quantity) } : current));
                                  void load();
                                }}
                              />
                            </div>
                            <fieldset className="flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50/40 p-3 md:col-span-2">
                              <legend className="px-1 text-sm font-bold text-red-700">⚡ {tf("sectionTitle")}</legend>
                              <p className="text-xs text-slate-600">{tf("sectionHelp")}</p>
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                                  {tf("salePrice")}
                                  <input type="number" inputMode="numeric" min="1" step="1" value={draft.salePrice} onChange={(e) => setDraft({ ...draft, salePrice: e.target.value })} className="min-h-11 rounded-lg border px-3 py-2 text-sm font-normal" />
                                </label>
                                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                                  {tf("saleStart")}
                                  <input type="datetime-local" value={draft.saleStart} onChange={(e) => setDraft({ ...draft, saleStart: e.target.value })} className="min-h-11 rounded-lg border px-3 py-2 text-sm font-normal" />
                                </label>
                                <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
                                  {tf("saleEnd")}
                                  <input type="datetime-local" value={draft.saleEnd} onChange={(e) => setDraft({ ...draft, saleEnd: e.target.value })} className="min-h-11 rounded-lg border px-3 py-2 text-sm font-normal" />
                                </label>
                              </div>
                              {(draft.salePrice || draft.saleStart || draft.saleEnd || listing.sale_price_xaf) && (
                                <button type="button" onClick={() => clearSale(listing)} className="min-h-10 self-start text-sm font-semibold text-red-700 underline cursor-pointer">{tf("clearSale")}</button>
                              )}
                              {saleError && <p role="alert" className="text-sm text-red-700">{saleError}</p>}
                            </fieldset>
                          </>
                        )}
                        {savedConditions && category !== "goods" && (
                          <MarketplaceConditionsFields category={category} value={conditions} onChange={setConditions} className="md:col-span-2" />
                        )}
                        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                          <input type="checkbox" checked={draft.allowOffers} onChange={(e) => setDraft({ ...draft, allowOffers: e.target.checked })} /> {t("fieldAllowOffers")}
                        </label>
                        <div className="flex gap-3 md:col-span-2">
                          <Button onClick={() => saveEdit(category, listing.id)}>{t("save")}</Button>
                          <button onClick={() => setEditingId(null)} className="text-sm font-semibold text-slate-500 cursor-pointer">{t("cancel")}</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                          <div className="min-w-0">
                            <Link href={`/marketplace/${category}/${listing.id}`} className="font-semibold text-[var(--navy)] hover:underline">{listing.title}</Link>
                            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-slate-600">
                              <span>
                                {listing.has_variants && listing.price_from_xaf
                                  ? t("priceFrom", { price: Number(listing.price_from_xaf).toLocaleString() })
                                  : `${Number(listing.price_xaf).toLocaleString()} XAF`}
                              </span>
                              {category === "goods" && (
                                <CompareAtPrice
                                  compareAtXaf={listing.compare_at_price_xaf} compact showUnit={false}
                                  shownPrice={Number(listing.has_variants && listing.price_from_xaf ? listing.price_from_xaf : listing.price_xaf)}
                                />
                              )}
                            </p>
                            {category === "goods" && listing.has_variants && (
                              <p className="mt-0.5 text-xs text-slate-500">{t("optionsSummary", { count: listing.variants?.length ?? 0, stock: listing.quantity ?? 0 })}</p>
                            )}
                            {listing.on_sale && listing.sale_price_xaf && listing.sale_ends_at && (
                              <p className="mt-0.5 text-xs font-semibold text-red-700">
                                ⚡ {tf("runningUntil", { price: Number(listing.sale_price_xaf).toLocaleString(), date: new Date(listing.sale_ends_at).toLocaleString() })}
                              </p>
                            )}
                            {listing.stats && (
                              <p className="mt-0.5 text-xs text-slate-500">
                                👁 {t("statViews", { count: listing.stats.views })} · ♥ {t("statSaves", { count: listing.stats.saves })} · 💬 {t("statChats", { count: listing.stats.chats })}
                              </p>
                            )}
                            {listing.is_boosted && listing.boosted_until && (
                              <p className="mt-0.5 text-xs font-semibold text-amber-700">
                                ⭐ {t("boostedUntil", { date: new Date(listing.boosted_until).toLocaleDateString() })}
                              </p>
                            )}
                            {listing.expires_at && !listing.removed_by_moderation && listing.availability_status === "AVAILABLE" && (
                              <p className={`mt-0.5 text-xs ${listing.is_expired ? "font-semibold text-red-700" : "text-slate-500"}`}>
                                {listing.is_expired ? t("expired") : t("expiresOn", { date: new Date(listing.expires_at).toLocaleDateString() })}
                              </p>
                            )}
                          </div>
                          <Badge variant={listing.availability_status === "AVAILABLE" ? "green" : "neutral"}>{t(`status_${listing.availability_status}`)}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          {listing.removed_by_moderation ? (
                            <p className="w-full rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{t("removedByModeration")}</p>
                          ) : (
                            <select
                              value={listing.availability_status}
                              onChange={(e) => run((token) => setMarketplaceListingStatus(category, listing.id, e.target.value as MarketplaceAvailability, token))}
                              className="border rounded-lg px-3 py-1.5 text-sm"
                              aria-label={t("statusLabel")}
                            >
                              {STATUSES.map((value) => <option key={value} value={value}>{t(`status_${value}`)}</option>)}
                            </select>
                          )}
                          {category === "cars" ? (
                            // Cars have a full spec sheet and rental terms, edited in the same step-by-step form they were posted with.
                            <Link href={`/marketplace/sell/cars?edit=${listing.id}`} className="text-sm font-semibold text-[var(--navy)] underline">{t("edit")}</Link>
                          ) : (
                            <button onClick={() => startEdit(category, listing)} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("edit")}</button>
                          )}
                          {category === "goods" && !listing.removed_by_moderation && (
                            <button onClick={() => startEdit(category, listing)} className="min-h-10 text-sm font-semibold text-[var(--navy)] underline cursor-pointer">
                              {listing.has_variants ? t("manageOptions") : t("addOptions")}
                            </button>
                          )}
                          <Link href={`/marketplace/${category}/${listing.id}`} className="text-sm font-semibold text-[var(--navy)] underline">{t("managePhotos")}</Link>
                          {!listing.removed_by_moderation && listing.availability_status === "AVAILABLE" && (
                            <button onClick={() => run((token) => renewMarketplaceListing(category, listing.id, token))} className="text-sm font-semibold text-green-700 underline cursor-pointer">
                              {listing.is_expired ? t("renewExpired") : t("renew")}
                            </button>
                          )}
                          {!listing.removed_by_moderation && listing.availability_status === "AVAILABLE" && !listing.is_expired && (
                            <button onClick={() => setBoostingId(boostingId === listing.id ? null : listing.id)} className="text-sm font-semibold text-amber-700 underline cursor-pointer">
                              {listing.is_boosted ? t("boostExtend") : t("boost")}
                            </button>
                          )}
                          <button onClick={() => confirmDelete(category, listing.id)} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("delete")}</button>
                        </div>
                        {boostingId === listing.id && (
                          <MarketplaceBoostPanel
                            category={category} listingId={listing.id}
                            onBoosted={() => { void load(); }} onClose={() => setBoostingId(null)}
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AccountSidebarLayout>
  );
}

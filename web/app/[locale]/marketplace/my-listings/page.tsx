"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMyMarketplaceListings, updateMarketplaceListing, setMarketplaceListingStatus, deleteMarketplaceListing, listQuarters,
  type MarketplaceCategory, type MarketplaceAvailability, type Quarter, type VehicleSpec, type GoodsCategory, type GoodsCondition,
  GOODS_CATEGORIES, GOODS_CONDITIONS,
} from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
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
}

interface Draft {
  title: string; description: string; price: string; priceBasis: string; quarter: string; deposit: string;
  sizeSqm: string; frontage: string; seating: string; revenue: string;
  goodwill: boolean; inventory: boolean;
  make: string; model: string; year: string; mileage: string; engine: string;
  itemCategory: string; condition: string; quantity: string;
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
  };
}

/** Only the fields that exist for this category; blank optional numbers are sent as null so they can be cleared. */
function payloadFrom(category: MarketplaceCategory, d: Draft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: d.title, description: d.description, price_xaf: d.price, price_basis: d.priceBasis, quarter: d.quarter || null,
    // A deposit only exists for rentals; switching a listing to a sale clears it.
    security_deposit_xaf: d.priceBasis === "SALE" ? "0" : d.deposit || "0",
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
    payload.quantity = Number(d.quantity) || 1;
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
    setConditions(EMPTY_CONDITIONS);
    setSavedConditions(null);
    const loaded = await loadConditionsDraft(category, listing.id).catch(() => null);
    if (!loaded) return;
    setConditions(loaded);
    setSavedConditions(loaded);
  }

  async function saveEdit(category: MarketplaceCategory, id: string) {
    if (!draft) return;
    // Stay in the editor on failure so the lister can correct the rejected value.
    if (!(await run((token) => updateMarketplaceListing(category, id, payloadFrom(category, draft), token)))) return;
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
        <Link href="/marketplace/sell" className="text-sm font-semibold text-[var(--navy)] underline">{t("postNew")}</Link>
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
                            <input type="number" min="1" max="100000" step="1" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} required aria-label={t("fieldQuantity")} placeholder={t("fieldQuantity")} className="border rounded-lg px-3 py-2 text-sm" />
                          </>
                        )}
                        {savedConditions && category !== "goods" && (
                          <MarketplaceConditionsFields category={category} value={conditions} onChange={setConditions} className="md:col-span-2" />
                        )}
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
                            <p className="text-sm text-slate-600">{Number(listing.price_xaf).toLocaleString()} XAF</p>
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
                          <button onClick={() => startEdit(category, listing)} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("edit")}</button>
                          <Link href={`/marketplace/${category}/${listing.id}`} className="text-sm font-semibold text-[var(--navy)] underline">{t("managePhotos")}</Link>
                          <button onClick={() => confirmDelete(category, listing.id)} className="text-sm font-semibold text-red-700 underline cursor-pointer">{t("delete")}</button>
                        </div>
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

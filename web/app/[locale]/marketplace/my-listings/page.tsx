"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMyMarketplaceListings, updateMarketplaceListing, setMarketplaceListingStatus, deleteMarketplaceListing,
  type MarketplaceCategory, type MarketplaceAvailability,
} from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";

const CATEGORIES: MarketplaceCategory[] = ["warehouses", "stores", "businesses", "cars"];
const STATUSES: MarketplaceAvailability[] = ["AVAILABLE", "UNDER_OFFER", "UNAVAILABLE"];

interface MyListing {
  id: string;
  title: string;
  description: string;
  price_xaf: string;
  availability_status: MarketplaceAvailability;
}

/** The lister's own marketplace listings across all four categories: edit, pause or mark sold, and delete. */
export default function MyMarketplaceListingsPage() {
  const t = useTranslations("MyMarketplaceListingsPage");
  const [rows, setRows] = useState<Record<MarketplaceCategory, MyListing[]>>({ warehouses: [], stores: [], businesses: [], cars: [] });
  const [state, setState] = useState<"loading" | "signedOut" | "ready">("loading");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", price: "", description: "" });

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
    setRows({ warehouses: results[0], stores: results[1], businesses: results[2], cars: results[3] });
    setState("ready");
  }, []);

  const load = useCallback(async () => applyRows((await fetchRows()) ?? null), [fetchRows, applyRows]);

  useEffect(() => {
    const pending = fetchRows();
    if (pending) pending.then(applyRows);
    else Promise.resolve().then(() => applyRows(null));
  }, [fetchRows, applyRows]);

  async function run(action: (token: string) => Promise<unknown>) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setError("");
    try {
      await action(token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  function startEdit(listing: MyListing) {
    setEditingId(listing.id);
    setDraft({ title: listing.title, price: String(Number(listing.price_xaf)), description: listing.description });
  }

  async function saveEdit(category: MarketplaceCategory, id: string) {
    await run((token) => updateMarketplaceListing(category, id, { title: draft.title, price_xaf: draft.price, description: draft.description }, token));
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
        <Link href="/marketplace" className="text-sm font-semibold text-[var(--navy)] underline">{t("postNew")}</Link>
      </div>

      {error && <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      {state === "loading" ? (
        <p className="text-slate-400">...</p>
      ) : state === "signedOut" ? (
        <EmptyState icon="🔒" title={t("signIn")} action={<Button href="/login">{t("signInButton")}</Button>} />
      ) : total === 0 ? (
        <EmptyState icon="🏷️" title={t("empty")} action={<Button href="/marketplace">{t("postNew")}</Button>} />
      ) : (
        <div className="flex flex-col gap-8">
          {CATEGORIES.filter((category) => rows[category].length > 0).map((category) => (
            <section key={category}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-3">{t(`category_${category}`)}</h2>
              <div className="flex flex-col gap-3">
                {rows[category].map((listing) => (
                  <div key={listing.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    {editingId === listing.id ? (
                      <div className="flex flex-col gap-2">
                        <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} className="border rounded-lg px-3 py-2 text-sm" />
                        <input type="number" min="0" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                        <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                        <div className="flex gap-3">
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
                          <select
                            value={listing.availability_status}
                            onChange={(e) => run((token) => setMarketplaceListingStatus(category, listing.id, e.target.value as MarketplaceAvailability, token))}
                            className="border rounded-lg px-3 py-1.5 text-sm"
                            aria-label={t("statusLabel")}
                          >
                            {STATUSES.map((value) => <option key={value} value={value}>{t(`status_${value}`)}</option>)}
                          </select>
                          <button onClick={() => startEdit(listing)} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("edit")}</button>
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

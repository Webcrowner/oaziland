"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { listMarketplaceListings, createMarketplaceListing, listQuarters, type WarehouseListing, type Quarter } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const PRICE_BASIS_LABELS: Record<string, string> = {
  SALE: "For Sale", RENT_NIGHTLY: "Rent / Night", RENT_WEEKLY: "Rent / Week", RENT_MONTHLY: "Rent / Month", RENT_ANNUAL: "Rent / Year",
};

export default function WarehousesMarketplacePage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const [listings, setListings] = useState<WarehouseListing[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [priceBasis, setPriceBasis] = useState("RENT_MONTHLY");
  const [price, setPrice] = useState("");
  const [sizeSqm, setSizeSqm] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    listMarketplaceListings<WarehouseListing>("warehouses")
      .then((data) => setListings(data.results)).catch(() => setListings([])).finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
    listQuarters().then(setQuarters).catch(() => {});
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      await createMarketplaceListing("warehouses", { title, price_basis: priceBasis, price_xaf: price, size_sqm: sizeSqm, quarter: quarterId || null }, token);
      setShowForm(false);
      setTitle(""); setPrice(""); setSizeSqm("");
      load();
    } catch {
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("warehousesTitle")} subtitle={t("warehousesSubtitle")}
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listAWarehouse")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <input required placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
          <input required type="number" placeholder={t("sizeSqmPlaceholder")} value={sizeSqm} onChange={(e) => setSizeSqm(e.target.value)} className="border rounded-lg px-3 py-2" />
          <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value)} className="border rounded-lg px-3 py-2">
            {Object.entries(PRICE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input required type="number" placeholder={t("pricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} className="border rounded-lg px-3 py-2" />
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2">
            <option value="">{t("chooseNeighborhood")}</option>
            {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        <EmptyState icon="🏭" title={t("noWarehousesYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listAWarehouse")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => (
            <Card key={listing.id}>
              <CardMedia label={t("noPhotoYet")} />
              <CardBody>
                <p className="font-semibold text-[var(--navy)] mb-1">{listing.title}</p>
                <p className="text-sm text-gray-500 mb-2">{listing.size_sqm} m²</p>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="gold">{PRICE_BASIS_LABELS[listing.price_basis]}</Badge>
                  {listing.quarter_name && <Badge variant="neutral">{listing.quarter_name}</Badge>}
                </div>
                <p className="text-lg font-bold text-[var(--navy)]">{Number(listing.price_xaf).toLocaleString()} XAF</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}

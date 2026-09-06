"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { listMarketplaceListings, createMarketplaceListing, listQuarters, type CarListing, type Quarter } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const PRICE_BASIS_LABELS: Record<string, string> = {
  SALE: "For Sale", RENT_NIGHTLY: "Rent / Night", RENT_WEEKLY: "Rent / Week", RENT_MONTHLY: "Rent / Month", RENT_ANNUAL: "Rent / Year",
};

/**
 * Cars — the richest of the four marketplace categories, with a real
 * composed VehicleSpec written in the same request as the listing
 * itself, not a separate manual step. Built on the shared UI
 * foundation (PageHeader, Card, EmptyState, Badge, Button).
 */
export default function CarsMarketplacePage() {
  const t = useTranslations("MarketplaceCategoryPage");
  const [listings, setListings] = useState<CarListing[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [priceBasis, setPriceBasis] = useState("SALE");
  const [price, setPrice] = useState("");
  const [quarterId, setQuarterId] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [mileage, setMileage] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  const load = useCallback(() => {
    listMarketplaceListings<CarListing>("cars")
      .then((data) => setListings(data.results))
      .catch(() => setListings([]))
      .finally(() => setStatus("ready"));
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
      await createMarketplaceListing("cars", {
        title, price_basis: priceBasis, price_xaf: price, quarter: quarterId || null,
        vehicle_spec: { make, model, year: Number(year), mileage_km: mileage ? Number(mileage) : null },
      }, token);
      setShowForm(false);
      setTitle(""); setPrice(""); setMake(""); setModel(""); setYear(""); setMileage("");
      load();
    } catch {
      setErrorText(t("submitFailed"));
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("carsTitle")} subtitle={t("carsSubtitle")}
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listACar")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <input required placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
          <input required placeholder={t("makePlaceholder")} value={make} onChange={(e) => setMake(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input required placeholder={t("modelPlaceholder")} value={model} onChange={(e) => setModel(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input required type="number" placeholder={t("yearPlaceholder")} value={year} onChange={(e) => setYear(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input type="number" placeholder={t("mileagePlaceholder")} value={mileage} onChange={(e) => setMileage(e.target.value)} className="border rounded-lg px-3 py-2" />
          <select value={priceBasis} onChange={(e) => setPriceBasis(e.target.value)} className="border rounded-lg px-3 py-2">
            {Object.entries(PRICE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input required type="number" placeholder={t("pricePlaceholder")} value={price} onChange={(e) => setPrice(e.target.value)} className="border rounded-lg px-3 py-2" />
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2">
            <option value="">{t("chooseNeighborhood")}</option>
            {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{errorText}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitListing")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        <EmptyState icon="🚗" title={t("noCarsYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listACar")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listings.map((listing) => (
            <Card key={listing.id}>
              <CardMedia label={t("noPhotoYet")} />
              <CardBody>
                <p className="font-semibold text-[var(--navy)] mb-1">{listing.title}</p>
                <p className="text-sm text-gray-500 mb-2">{listing.vehicle_spec.year} {listing.vehicle_spec.make} {listing.vehicle_spec.model}</p>
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

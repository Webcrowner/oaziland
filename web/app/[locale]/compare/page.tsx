"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyComparison, getListing, type Listing } from "@/lib/api";

export default function ComparePage() {
  const t = useTranslations("ComparisonPage");
  const [listings, setListings] = useState<Listing[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    getMyComparison(token)
      .then(async (comparison) => {
        if (!comparison) {
          setStatus("ready");
          return;
        }
        const fetched = await Promise.all(comparison.listing_ids.map((id) => getListing(id).catch(() => null)));
        setListings(fetched.filter((l): l is Listing => l !== null));
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Link href="/login" className="inline-block bg-[#1B2A4A] text-white font-semibold px-6 py-3 rounded hover:opacity-90">
          {t("signInRequired")}
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : listings.length === 0 ? (
        <p className="text-gray-500">{t("noComparisonYet")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <td className="w-32"></td>
                {listings.map((listing) => (
                  <td key={listing.id} className="border p-4 text-center bg-white">
                    <p className="font-bold text-lg text-[#1B2A4A]">{Number(listing.price_xaf).toLocaleString()} XAF</p>
                    <Link href={`/listing/${listing.id}`} className="text-sm text-[#1B2A4A] underline">{t("viewListing")}</Link>
                  </td>
                ))}
              </tr>
              {[
                { labelKey: "location", getValue: (l: Listing) => l.property_asset.quarter_name },
                { labelKey: "type", getValue: (l: Listing) => l.property_asset.type },
                { labelKey: "size", getValue: (l: Listing) => (l.property_asset.size_sqm ? `${l.property_asset.size_sqm} m²` : "—") },
                { labelKey: "finish", getValue: (l: Listing) => l.property_asset.finish_level || "—" },
              ].map((row) => (
                <tr key={row.labelKey}>
                  <td className="border p-3 font-semibold text-sm text-gray-600 bg-gray-50">{t(row.labelKey)}</td>
                  {listings.map((listing) => (
                    <td key={listing.id} className="border p-3 text-center text-sm">{row.getValue(listing)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listWantedListings } from "@/lib/api";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Je Recherche... Annonces de Demande | Oaziland" : "Looking For... Wanted Listings | Oaziland",
    description: locale === "fr"
      ? "De vraies demandes de chambres, boutiques, entrepôts et entreprises au Cameroun — répondez si vous avez une correspondance."
      : "Real requests for rooms, stores, warehouses, and businesses across Cameroon — respond if you have a match.",
  };
}

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  ROOM_RENTAL: "categoryRoom",
  STORE: "categoryStore",
  WAREHOUSE: "categoryWarehouse",
  BUSINESS: "categoryBusiness",
  BUSINESS_AREA: "categoryBusinessArea",
};

/**
 * The "Looking For" board — real requests from students, traders, and
 * buyers, per the founder's explicit demand signal. Server-rendered,
 * same SSR pattern as every other browse page.
 */
export default async function WantedBoardPage() {
  const t = await getTranslations("WantedBoardPage");
  const data = await listWantedListings().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-[#1B2A4A]">{t("title")}</h1>
        <Link href="/login" className="bg-[#C9A227] text-[#1B2A4A] font-semibold px-4 py-2 rounded text-sm hover:opacity-90">
          {t("postRequest")}
        </Link>
      </div>
      <p className="text-gray-600 mb-6">{t("subtitle")}</p>

      {data.results.length === 0 ? (
        <p className="text-gray-500">{t("noWantedListingsYet")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {data.results.map((item) => (
            <div key={item.id} className="border rounded-lg p-4 bg-white">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase text-white bg-[#1B2A4A] px-2 py-1 rounded">
                  {t(CATEGORY_LABEL_KEYS[item.category] || "categoryRoom")}
                </span>
                {item.quarter_name && <span className="text-xs text-gray-500">{item.quarter_name}</span>}
              </div>
              <p className="text-gray-800 mb-2">{item.notes}</p>
              <div className="flex gap-4 text-xs text-gray-500 mb-2">
                {item.max_budget_xaf && <span>{t("budgetUpTo", { amount: Number(item.max_budget_xaf).toLocaleString() })}</span>}
                {item.min_size_sqm && <span>{t("sizeAtLeast", { size: item.min_size_sqm })}</span>}
              </div>
              <p className="text-xs text-gray-400 mb-3">{t("postedOn", { date: new Date(item.created_at).toLocaleDateString() })}</p>
              <Link href="/login" className="text-sm font-semibold text-[#1B2A4A] hover:text-[#C9A227]">
                {t("signInToRespond")} →
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

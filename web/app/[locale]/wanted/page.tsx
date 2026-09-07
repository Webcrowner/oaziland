import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listWantedListings } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
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
 * The "Looking For" board — brought onto the shared UI foundation
 * (PageHeader, EmptyState, Badge, Button), continuing the page-by-
 * page pass. Real requests from students, traders, and buyers, per
 * the founder's explicit demand signal. Server-rendered, same SSR
 * pattern as every other browse page.
 */
export default async function WantedBoardPage() {
  const t = await getTranslations("WantedBoardPage");
  const data = await listWantedListings().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader
        title={t("title")} subtitle={t("subtitle")}
        action={<Button href="/login">{t("postRequest")}</Button>}
      />

      {data.results.length === 0 ? (
        <EmptyState icon="🔍" title={t("noWantedListingsYet")} />
      ) : (
        <div className="flex flex-col gap-4">
          {data.results.map((item) => (
            <div key={item.id} className="border rounded-lg p-4 bg-white">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="navy">{t(CATEGORY_LABEL_KEYS[item.category] || "categoryRoom")}</Badge>
                {item.quarter_name && <span className="text-xs text-gray-500">📍 {item.quarter_name}</span>}
              </div>
              <p className="text-gray-800 mb-2">{item.notes}</p>
              <div className="flex gap-4 text-xs text-gray-500 mb-2">
                {item.max_budget_xaf && <span>{t("budgetUpTo", { amount: Number(item.max_budget_xaf).toLocaleString() })}</span>}
                {item.min_size_sqm && <span>{t("sizeAtLeast", { size: item.min_size_sqm })}</span>}
              </div>
              <p className="text-xs text-gray-400 mb-3">{t("postedOn", { date: new Date(item.created_at).toLocaleDateString() })}</p>
              <Link href="/login" className="text-sm font-semibold text-[var(--navy)] hover:text-[var(--gold)]">
                {t("signInToRespond")} →
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

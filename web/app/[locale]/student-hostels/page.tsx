import { getTranslations } from "next-intl/server";
import { searchStudentHostels } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Résidences Étudiantes au Cameroun | Oaziland" : "Student Hostels in Cameroon | Oaziland",
    description: locale === "fr"
      ? "Des hébergements étudiants vérifiés près des universités camerounaises."
      : "Verified student accommodation near Cameroonian universities.",
  };
}

/**
 * Student Hostels — brought onto the shared UI foundation, same
 * pattern as Events and Guest Houses. Real bed capacity now shown as
 * an icon stat (the same pattern as bed/bath on PropertyCard) rather
 * than only being implied by the unit type badge.
 */
export default async function StudentHostelsPage() {
  const t = await getTranslations("StudentHostelsPage");
  const tCard = await getTranslations("PropertyCard");
  const data = await searchStudentHostels().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="🎓" title={t("noHostelsYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.results.map((hostel) => {
            const totalBeds = hostel.units.reduce((sum, u) => sum + (u.bed_capacity || 0), 0);
            return (
              <Card key={hostel.id}>
                <CardMedia label={tCard("noPhotoYet")} />
                <CardBody>
                  <p className="text-sm text-gray-500 mb-2">📍 {hostel.quarter_name}</p>

                  <div className="flex items-center gap-3 text-sm text-gray-700 mb-2">
                    {totalBeds > 0 && <span className="flex items-center gap-1">🛏 {totalBeds}</span>}
                    <span>
                      {hostel.units.length === 1 ? t("unitsAvailable", { count: hostel.units.length }) : t("unitsAvailableOther", { count: hostel.units.length })}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {hostel.units.slice(0, 3).map((unit) => (
                      <Badge key={unit.id} variant="navy">{unit.unit_type}</Badge>
                    ))}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

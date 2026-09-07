import { getTranslations } from "next-intl/server";
import { listTestimonials } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Témoignages | Oaziland" : "Testimonials | Oaziland",
    description: locale === "fr" ? "De vrais retours de nos utilisateurs." : "Real feedback from our users.",
  };
}

/**
 * WHY this page can show an honest empty state: testimonials are
 * pulled from real, completed-booking-linked reviews only — never
 * fabricated placeholder quotes. An early-stage platform may
 * genuinely have few or none yet, and that's shown plainly rather
 * than faked. Brought onto the shared UI foundation (PageHeader,
 * EmptyState) continuing the page-by-page pass.
 */
export default async function TestimonialsPage() {
  const t = await getTranslations("TestimonialsPage");
  const data = await listTestimonials().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="💬" title={t("noTestimonialsYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {data.results.map((testimonial, i) => (
            <div key={i} className="border rounded-lg p-5 bg-white">
              <p className="text-[var(--gold)] mb-2">{"★".repeat(testimonial.score)}</p>
              <p className="text-gray-700 italic mb-3">&ldquo;{testimonial.text}&rdquo;</p>
              <p className="text-sm font-semibold text-[var(--navy)]">{testimonial.author_name}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

import { getTranslations } from "next-intl/server";
import { listTestimonials } from "@/lib/api";
import EmptyState from "@/components/ui/EmptyState";
import LoadErrorNotice from "@/components/ui/LoadErrorNotice";
import { IconMessageCircle, IconStar } from "@/components/Icons";
import ReportContentButton from "@/components/ReportContentButton";
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
  const fetched = await listTestimonials().catch(() => null);
  const loadFailed = fetched === null;
  const data = fetched ?? { count: 0, results: [] };
  const average = data.results.length > 0 ? data.results.reduce((sum, r) => sum + r.score, 0) / data.results.length : null;

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-8">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6 p-6 sm:p-10">
          <div className="max-w-xl">
            <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl font-black tracking-tight">{t("title")}</h1>
            <p className="mt-2 text-sm sm:text-base leading-relaxed text-slate-400">{t("subtitle")}</p>
          </div>
          {average !== null && (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-8 py-5 text-center">
              <p className="text-5xl font-black tracking-tight">{average.toFixed(1)}</p>
              <Stars value={average} size={18} className="mt-2 justify-center" />
            </div>
          )}
        </div>
      </section>

      {loadFailed ? (
        <LoadErrorNotice message={t("loadFailed")} />
      ) : data.results.length === 0 ? (
        <EmptyState icon={<IconMessageCircle size={28} />} title={t("noTestimonialsYet")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {data.results.map((testimonial) => (
            <figure key={testimonial.id} className="flex flex-col rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <Stars value={testimonial.score} />
              <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-slate-700">
                &ldquo;{testimonial.text}&rdquo;
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-black text-amber-300">
                  {(testimonial.author_name.charAt(0) || "?").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{testimonial.author_name}</span>
                <ReportContentButton kind="review" id={String(testimonial.id)} ownerId={testimonial.author_id} variant="inline" />
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}

function Stars({ value, size = 14, className = "" }: { value: number; size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-0.5 ${className}`} role="img" aria-label={`${value.toFixed(1)} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} size={size} className={i <= Math.round(value) ? "text-amber-400" : "text-slate-300"} />
      ))}
    </span>
  );
}

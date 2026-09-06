import { getTranslations } from "next-intl/server";
import { listJobPostings } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import JobApplyButton from "@/components/JobApplyButton";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === "fr" ? "Emplois — Immobilier et Hôtellerie | Oaziland" : "Jobs — Real Estate & Hospitality | Oaziland",
    description: locale === "fr"
      ? "Offres d'emploi réelles dans l'immobilier et l'hôtellerie au Cameroun."
      : "Real job openings in real estate and hospitality across Cameroon.",
  };
}

const ROLE_LABELS: Record<string, string> = {
  PROPERTY_MANAGER: "Property Manager", AGENT: "Agent", HOSTEL_WARDEN: "Hostel Warden",
  MAINTENANCE_STAFF: "Maintenance Staff", DRIVER: "Driver", OTHER: "Other",
};

/**
 * Careers — a real gap this closes: JobPosting/JobApplication had
 * real models and real service functions, but no way for anyone to
 * actually see an opening or apply. Server-rendered, same pattern as
 * every other browse page — real data at request time, no client
 * fetch for the listing itself.
 */
export default async function CareersPage() {
  const t = await getTranslations("CareersPage");
  const data = await listJobPostings().catch(() => ({ count: 0, results: [] as never[] }));

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {data.results.length === 0 ? (
        <EmptyState icon="💼" title={t("noJobsYet")} />
      ) : (
        <div className="flex flex-col gap-4">
          {data.results.map((job) => (
            <div key={job.id} className="border border-gray-200 rounded-xl p-5 bg-white">
              <div className="flex items-start justify-between gap-4 flex-wrap mb-2">
                <div>
                  <h2 className="font-semibold text-[var(--navy)] text-lg">{job.title}</h2>
                  <p className="text-xs text-gray-500 uppercase font-semibold mt-1">
                    {ROLE_LABELS[job.role_category] || job.role_category}
                    {job.quarter_name && ` · ${job.quarter_name}`}
                  </p>
                </div>
                {job.salary_min_xaf && job.salary_max_xaf && (
                  <p className="text-sm font-semibold text-[var(--navy)] whitespace-nowrap">
                    {Number(job.salary_min_xaf).toLocaleString()} – {Number(job.salary_max_xaf).toLocaleString()} XAF
                  </p>
                )}
              </div>
              <p className="text-sm text-gray-600 mb-4">{job.description}</p>
              <JobApplyButton jobId={job.id} applyLabel={t("apply")} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

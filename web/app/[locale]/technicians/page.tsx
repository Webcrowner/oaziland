"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listTechnicianDirectory, type TechnicianDirectoryItem } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Avatar from "@/components/Avatar";
import { useTasklnLabels, TASKLN_CATEGORY_CODES } from "@/lib/useTasklnLabels";

/** Public directory of admin-verified technicians, filterable by specialty. */
export default function TechniciansDirectoryPage() {
  const t = useTranslations("TechniciansDirectoryPage");
  const labels = useTasklnLabels();
  const [specialty, setSpecialty] = useState("");
  const [technicians, setTechnicians] = useState<TechnicianDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listTechnicianDirectory(specialty || undefined)
      .then(setTechnicians)
      .catch(() => setTechnicians([]))
      .finally(() => setLoading(false));
  }, [specialty]);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={<Link href="/taskln-service" className="text-sm text-[var(--navy)] underline whitespace-nowrap">{t("requestJob")}</Link>}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setSpecialty("")}
          className={`text-xs px-3 py-1.5 rounded-full border ${specialty === "" ? "bg-[var(--navy)] text-white border-[var(--navy)]" : "border-gray-300 text-gray-600"}`}
        >
          {t("all")}
        </button>
        {TASKLN_CATEGORY_CODES.map((value) => (
          <button
            key={value}
            onClick={() => setSpecialty(value)}
            className={`text-xs px-3 py-1.5 rounded-full border ${specialty === value ? "bg-[var(--navy)] text-white border-[var(--navy)]" : "border-gray-300 text-gray-600"}`}
          >
            {labels.category(value)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400">...</p>
      ) : technicians.length === 0 ? (
        <EmptyState icon="🛠️" title={t("empty")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {technicians.map((tech) => (
            <Link
              key={tech.user_id}
              href={`/user/${tech.user_id}`}
              className="flex items-center gap-3 border border-gray-200 rounded-xl p-4 bg-white hover:border-[var(--navy)] transition-colors"
            >
              <Avatar
                src={tech.profile_image_url}
                name={tech.name}
                className="w-12 h-12 rounded-xl bg-slate-900 text-amber-400 text-lg font-black"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{tech.name}</p>
                <p className="text-xs text-gray-500 truncate">{tech.specialties.map((s) => labels.category(s)).join(", ")}</p>
                <p className="text-xs text-gray-500">
                  {tech.avg_rating > 0 ? `${tech.avg_rating.toFixed(1)} ★` : t("noRatings")} · {t("jobsCount", { count: tech.completed_jobs })}
                  {tech.quarter_name ? ` · ${tech.quarter_name}` : ""}
                </p>
                {tech.portfolio_urls.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {tech.portfolio_urls.slice(0, 3).map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={url} alt="" className="w-9 h-9 object-cover rounded-md border border-gray-200" />
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

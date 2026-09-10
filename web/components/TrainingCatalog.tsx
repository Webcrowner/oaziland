"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { enrollInTraining, getMyEnrollments, type TrainingProgram } from "@/lib/api";

/**
 * A client-side island for enrollment — the training LIST itself is
 * server-rendered (see the page.tsx wrapping this), but enrolling
 * requires a real authenticated POST.
 */
export default function TrainingCatalog({ programs }: { programs: TrainingProgram[] }) {
  const t = useTranslations("TrainingPage");
  const router = useRouter();
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoggedIn(true);
    getMyEnrollments(token)
      .then((data) => setEnrolledIds(new Set(data.results.map((e) => e.program))))
      .catch(() => {});
  }, []);

  async function handleEnroll(programId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setEnrollingId(programId);
    try {
      const res = await enrollInTraining(programId, token);
      if (res.ok || res.status === 409) {
        setEnrolledIds((prev) => new Set(prev).add(programId));
      }
    } finally {
      setEnrollingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {programs.map((program) => {
        const isEnrolled = enrolledIds.has(program.id);
        return (
          <div key={program.id} className="border rounded-lg p-4 bg-white flex flex-col">
            <p className="text-xs font-semibold uppercase text-[var(--navy)] bg-gray-100 px-2 py-1 rounded self-start mb-2">
              {program.category.replaceAll("_", " ")}
            </p>
            <h2 className="font-semibold text-[var(--navy)] mb-1">{program.title}</h2>
            {program.description && <p className="text-sm text-gray-600 mb-2 flex-1">{program.description}</p>}
            <p className="text-sm font-semibold text-[var(--gold)] mb-1">
              {program.price_xaf ? t("priceLabel", { price: Number(program.price_xaf).toLocaleString() }) : t("free")}
            </p>
            {program.issues_certification && <p className="text-xs text-gray-500 mb-3">🏅 {t("issuesCertificate")}</p>}

            <button
              onClick={() => handleEnroll(program.id)}
              disabled={isEnrolled || enrollingId === program.id}
              className="mt-auto bg-[var(--navy)] text-white font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50 text-sm"
            >
              {!loggedIn ? t("signInToEnroll") : isEnrolled ? t("alreadyEnrolled") : enrollingId === program.id ? t("enrolling") : t("enroll")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  enrollInTraining, getMyEnrollments, startTraining, dropTraining, completeTraining,
  type TrainingProgram, type TrainingEnrollmentItem,
} from "@/lib/api";

/**
 * A client-side island for enrollment — the training LIST itself is
 * server-rendered (see the page.tsx wrapping this), but enrolling
 * requires a real authenticated POST.
 */
export default function TrainingCatalog({ programs }: { programs: TrainingProgram[] }) {
  const t = useTranslations("TrainingPage");
  const router = useRouter();
  const [enrollments, setEnrollments] = useState<Map<string, TrainingEnrollmentItem>>(new Map());
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);

  function load() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoggedIn(true);
    getMyEnrollments(token)
      .then((data) => setEnrollments(new Map(data.results.map((e) => [e.program, e]))))
      .catch(() => {});
  }

  useEffect(() => {
    load();
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
      if (res.ok || res.status === 409) load();
    } finally {
      setEnrollingId(null);
    }
  }

  async function handleStart(enrollmentId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusyId(enrollmentId);
    try {
      await startTraining(enrollmentId, token);
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDrop(enrollmentId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusyId(enrollmentId);
    try {
      await dropTraining(enrollmentId, token);
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleComplete(enrollmentId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusyId(enrollmentId);
    try {
      await completeTraining(enrollmentId, token);
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {programs.map((program) => {
        const enrollment = enrollments.get(program.id);
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

            {!enrollment ? (
              <button
                onClick={() => handleEnroll(program.id)}
                disabled={enrollingId === program.id}
                className="mt-auto bg-[var(--navy)] text-white font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50 text-sm"
              >
                {!loggedIn ? t("signInToEnroll") : enrollingId === program.id ? t("enrolling") : t("enroll")}
              </button>
            ) : enrollment.status === "ENROLLED" ? (
              <div className="mt-auto flex gap-2">
                <button onClick={() => handleStart(enrollment.id)} disabled={busyId === enrollment.id} className="flex-1 bg-[var(--navy)] text-white font-semibold py-2 rounded text-xs disabled:opacity-50">
                  Start
                </button>
                <button onClick={() => handleDrop(enrollment.id)} disabled={busyId === enrollment.id} className="flex-1 border border-gray-300 text-gray-600 font-semibold py-2 rounded text-xs disabled:opacity-50">
                  Drop
                </button>
              </div>
            ) : enrollment.status === "IN_PROGRESS" ? (
              <div className="mt-auto flex flex-col gap-1.5">
                <button
                  onClick={() => handleComplete(enrollment.id)}
                  disabled={busyId === enrollment.id}
                  className="bg-emerald-600 text-white font-semibold py-2 rounded text-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  {program.issues_certification ? "Complete & Issue Certificate" : "Mark Complete"}
                </button>
                <button
                  onClick={() => handleDrop(enrollment.id)}
                  disabled={busyId === enrollment.id}
                  className="border border-gray-300 text-gray-600 font-semibold py-1.5 rounded text-xs disabled:opacity-50"
                >
                  Drop
                </button>
              </div>
            ) : (
              <div className="mt-auto text-center py-2">
                <p className="text-xs font-bold text-emerald-700">
                  {enrollment.status === "COMPLETED" ? `✓ ${t("alreadyEnrolled")}` : "Dropped"}
                </p>
                {enrollment.certificate_issued_at && (
                  <span className="inline-block mt-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    🏅 Certificate Issued
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

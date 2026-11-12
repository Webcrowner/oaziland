"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getCourseCertificateTemplate, setCourseCertificateTemplate, type CourseCertificateChoice } from "@/lib/api";
import CertificateCanvas from "@/components/admin/CertificateCanvas";

const token = () => (typeof window === "undefined" ? null : localStorage.getItem("access_token"));

/** The sample certificate's issue date (November 11, 2026, as in sampleValues) plus this course's validity. */
const sampleExpiry = (months: number) => {
  const date = new Date(2026, 10 + months, 11);
  return date.toLocaleDateString("en-US", { dateStyle: "long" });
};

/** Course settings → which certificate design this course's graduates receive. Admins choose; others can see it. */
export default function CourseCertificatePicker({ courseId, courseTitle, lessonCount, durationHours, validityMonths, issuesCertificate }: {
  courseId: string; courseTitle: string; lessonCount: number; durationHours: string | null; validityMonths: number | null; issuesCertificate: boolean;
}) {
  const t = useTranslations("CourseCertificate");
  const [data, setData] = useState<CourseCertificateChoice | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const tk = token();
    if (!tk) return;
    try {
      setData(await getCourseCertificateTemplate(courseId, tk));
    } catch {
      setFailed(true);
    }
  }, [courseId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  if (failed) return <p className="max-w-xl rounded-xl bg-red-50 p-3 text-sm text-red-700">{t("loadFailed")}</p>;
  if (!data) return null;

  const chosen = data.options.find((option) => option.id === data.template_id) ?? null;
  const shown = chosen ?? data.default;
  const defaultName = data.default ? data.default.name : t("builtin");

  const choose = async (value: string) => {
    const tk = token();
    if (!tk) return;
    setSaving(true);
    setNotice("");
    try {
      setData(await setCourseCertificateTemplate(courseId, value || null, tk));
      setNotice(t("saved"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-xl space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="font-bold text-slate-900">🎓 {t("title")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("hint")}</p>
      </div>
      {!issuesCertificate && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{t("notIssuing")}</p>}

      {data.can_change ? (
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-slate-600">{t("template")}</span>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={data.template_id ?? ""}
            disabled={saving}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">{t("useDefault", { name: defaultName })}</option>
            {data.options.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-slate-700">{t("current", { name: chosen ? chosen.name : t("useDefault", { name: defaultName }) })}</p>
      )}
      {notice && <p role="status" className="text-xs font-semibold text-emerald-700">{notice}</p>}

      <div className="pointer-events-none mx-auto max-w-md overflow-hidden rounded border border-slate-200 shadow">
        <CertificateCanvas
          orientation={shown?.orientation ?? "LANDSCAPE"}
          backgroundColor={shown?.background_color ?? data.builtin.background_color}
          backgroundImageUrl={shown?.background_image_url ?? ""}
          logoUrl={shown?.logo_url ?? ""}
          signatureUrl={shown?.signature_url ?? ""}
          layout={shown?.layout ?? data.builtin.layout}
          lang="en"
          sampleOverrides={{
            course_title: courseTitle,
            lessons: lessonCount ? t("lessons", { count: lessonCount }) : "",
            course_hours: durationHours ? t("hours", { count: Number(durationHours) }) : "",
            ...(validityMonths ? { expiry_date: sampleExpiry(validityMonths) } : { expiry_date: "" }),
          }}
        />
      </div>
      {data.can_change && (
        <p className="text-xs text-slate-500">
          {t("designHint")}{" "}
          <Link href="/admin?tab=certificates" className="font-semibold text-[var(--navy)] underline">{t("openDesigner")}</Link>
        </p>
      )}
    </section>
  );
}

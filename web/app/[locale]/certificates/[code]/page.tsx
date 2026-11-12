import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { certificateImageUrl, certificatePdfUrl, getCertificate, type CourseCertificate } from "@/lib/api";
import CertificateActions from "@/components/CertificateActions";

type Params = Promise<{ locale: string; code: string }>;

async function load(code: string): Promise<CourseCertificate | null> {
  try {
    return await getCertificate(code);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { code } = await params;
  const certificate = await load(code);
  return {
    title: certificate ? `${certificate.learner_name} — ${certificate.course_title} | Oaziland` : "Certificate | Oaziland",
    robots: { index: false, follow: false },
  };
}

export default async function CertificatePage({ params }: { params: Params }) {
  const { code, locale } = await params;
  const t = await getTranslations("Certificate");
  const certificate = await load(code);

  if (!certificate) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <p className="mb-2 text-5xl" aria-hidden>🔍</p>
        <h1 className="mb-2 text-2xl font-bold text-slate-900">{t("notFoundTitle")}</h1>
        <p className="mb-6 text-slate-600">{t("notFoundBody", { code: decodeURIComponent(code).toUpperCase() })}</p>
        <Link href="/trainings" className="font-semibold text-[var(--navy)] underline">{t("browseCourses")}</Link>
      </main>
    );
  }

  const issued = new Date(certificate.issued_at).toLocaleDateString(locale, { dateStyle: "long" });
  const longDate = (value: string) => new Date(value).toLocaleDateString(locale, { dateStyle: "long" });
  const portrait = certificate.orientation === "PORTRAIT";
  const details = [
    { label: t("completedOn"), value: longDate(certificate.completed_at) },
    { label: t("issuedOn"), value: issued },
    certificate.hours !== null && { label: t("duration"), value: t("hours", { count: certificate.hours }) },
    certificate.grade_percent !== null && {
      label: t("finalGrade"), value: new Intl.NumberFormat(locale, { style: "percent" }).format(certificate.grade_percent / 100),
    },
    { label: certificate.is_expired ? t("expiredOn") : t("validUntil"), value: certificate.expires_at ? longDate(certificate.expires_at) : t("neverExpires") },
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 print:max-w-none print:p-0">
      {/* Only the certificate itself goes on paper. */}
      <style>{"@media print { header, footer, nav, [aria-label='Chat with support'] { display: none !important; } @page { size: A4 " + (portrait ? "portrait" : "landscape") + "; margin: 8mm; } }"}</style>

      {certificate.is_expired ? (
        <p role="alert" className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-900 print:hidden">
          ⚠ {t("expired", { name: certificate.learner_name, date: longDate(certificate.expires_at as string) })}
        </p>
      ) : (
        <p className="mb-6 flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-semibold text-emerald-800 print:hidden">
          ✓ {t("verified", { name: certificate.learner_name })}
        </p>
      )}

      {/* Drawn by the server from the admin's active certificate template — the same image as the PDF. */}
      <figure className={`mx-auto overflow-hidden rounded-lg bg-white shadow-xl print:shadow-none ${portrait ? "max-w-xl" : ""}`}>
        <Image
          src={certificateImageUrl(certificate.code, locale)}
          alt={`${t("heading")} — ${certificate.learner_name}, ${certificate.course_title}`}
          width={1600}
          height={portrait ? 2262 : 1131}
          unoptimized
          priority
          className="h-auto w-full"
        />
      </figure>
      <div className="sr-only">
        <h1>{certificate.learner_name}</h1>
        <p>{t("forCompleting")} {certificate.course_title}</p>
        <p>{t("deliveredBy")} — {certificate.provider_name}</p>
        <p>{t("verifyAt")} {certificate.code}</p>
      </div>

      {/* The certificate's details as text, for employers and screen readers (the certificate itself is an image). */}
      <dl className="mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3 print:hidden">
        {details.map((item) => (
          <div key={item.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</dt>
            <dd className={`font-semibold ${item.label === t("expiredOn") ? "text-amber-700" : "text-slate-900"}`}>{item.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 flex flex-col items-center gap-4">
        <a
          href={certificatePdfUrl(certificate.code, locale)}
          className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-amber-600 print:hidden"
        >
          ⬇ {t("downloadPdf")}
        </a>
        <CertificateActions />
        <Link href={`/trainings/${certificate.course_id}`} className="text-sm font-semibold text-[var(--navy)] underline print:hidden">
          {t("viewCourse")}
        </Link>
      </div>
    </main>
  );
}

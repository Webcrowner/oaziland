import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listPublicFaqs } from "@/lib/api";
import InteractiveFaqAccordion from "@/components/home/InteractiveFaqAccordion";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("FaqPage");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function FaqPage() {
  const t = await getTranslations("FaqPage");
  const faqs = await listPublicFaqs(await getLocale()).catch(() => []);

  // Lets search engines show the questions as rich results.
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <main className="bg-white min-h-[60vh]">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <InteractiveFaqAccordion faqs={faqs} />
      <div className="text-center pb-16 -mt-6">
        <p className="text-sm text-slate-500 mb-2">{t("stillHaveQuestions")}</p>
        <Link href="/contact" className="inline-block gold-gradient text-[var(--navy)] font-bold text-sm px-5 py-2.5 rounded-xl">
          {t("contactUs")}
        </Link>
      </div>
    </main>
  );
}

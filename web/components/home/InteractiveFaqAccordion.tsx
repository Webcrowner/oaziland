"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { IconSparkles } from "@/components/Icons";
import type { Faq } from "@/lib/api";

export default function InteractiveFaqAccordion({ faqs, showViewAll = false }: { faqs: Faq[]; showViewAll?: boolean }) {
  const t = useTranslations("FaqSection");
  const [openIndex, setOpenIndex] = useState<number | null>(0); // First open by default

  function toggleFaq(index: number) {
    setOpenIndex((prev) => (prev === index ? null : index));
  }

  if (faqs.length === 0) return null;

  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 bg-white border-b border-slate-200/80">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-2">
            <IconSparkles size={12} className="text-amber-600" />
            <span>{t("badge")}</span>
          </div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
            {t("title")}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">{t("subtitle")}</p>
        </div>

        {/* Accordion list */}
        <div className="space-y-3">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={faq.id}
                className="border border-slate-200 rounded-2xl overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(index)}
                  className="w-full text-left p-4 sm:p-5 flex items-center justify-between gap-4 font-bold text-sm sm:text-base text-slate-900 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                >
                  <span>{faq.question}</span>
                  <span
                    className={`w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 text-sm shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-180 bg-amber-400 text-slate-950 border-amber-400" : ""
                    }`}
                  >
                    ▾
                  </span>
                </button>

                {isOpen && (
                  <div className="p-4 sm:p-5 pt-0 bg-slate-50/50 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100 whitespace-pre-line">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {showViewAll && (
          <div className="text-center mt-6">
            <Link href="/faq" className="text-sm font-bold text-amber-700 hover:text-amber-800 underline">
              {t("viewAll")}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

/** Print (or "Save as PDF" in the print dialog) and copy the public verification link. */
export default function CertificateActions() {
  const t = useTranslations("Certificate");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(t("copyLink"), window.location.href);
    }
  }

  return (
    <div className="flex flex-wrap justify-center gap-3 print:hidden">
      <button onClick={() => window.print()} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#25396a]">
        🖨 {t("print")}
      </button>
      <button onClick={copy} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
        {copied ? `✓ ${t("copied")}` : `🔗 ${t("copyLink")}`}
      </button>
    </div>
  );
}

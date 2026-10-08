"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { submitContactMessage } from "@/lib/api";
import Button from "@/components/ui/Button";
import { IconAlertCircle, IconCheckCircle, IconMapPin, IconMessageCircle } from "@/components/Icons";

const inputClass =
  "w-full px-4 py-3 text-sm rounded-xl border border-slate-300 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all";
const labelClass = "block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5";

/**
 * A real, working contact form — posts to the actual public
 * /api/contact/ endpoint (which notifies a real admin), not a
 * decorative form that goes nowhere.
 */
export default function ContactPage() {
  const t = useTranslations("ContactPage");
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      await submitContactMessage(form);
      setStatus("success");
      setForm({ name: "", email: "", message: "" });
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="bg-slate-200 min-h-[75vh]">
      <section className="relative overflow-hidden text-slate-900 px-4 pt-14 pb-10 sm:pt-16">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-amber-400/20 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          <span className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center mb-4">
            <IconMessageCircle size={24} />
          </span>
          <h1 className="font-[family-name:var(--font-display)] text-3xl sm:text-4xl font-bold mb-2">{t("title")}</h1>
          <p className="text-slate-600 max-w-2xl">{t("subtitle")}</p>
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-2 bg-white border border-slate-300 rounded-3xl p-6 sm:p-8 shadow-xl shadow-slate-400/30 flex flex-col gap-5 relative"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="contact-name" className={labelClass}>{t("nameLabel")}</label>
                <input
                  id="contact-name" type="text" required autoComplete="name" className={inputClass}
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="contact-email" className={labelClass}>{t("emailLabel")}</label>
                <input
                  id="contact-email" type="email" required autoComplete="email" className={inputClass}
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor="contact-message" className={labelClass}>{t("messageLabel")}</label>
              <textarea
                id="contact-message" required rows={6} className={`${inputClass} resize-y`}
                value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </div>

            {status === "success" && (
              <p className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3" role="status">
                <IconCheckCircle size={18} className="shrink-0 text-emerald-600" /> {t("success")}
              </p>
            )}
            {status === "error" && (
              <p className="flex items-center gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3" role="alert">
                <IconAlertCircle size={18} className="shrink-0" /> {t("error")}
              </p>
            )}

            <Button size="lg" className="w-full sm:w-auto sm:self-start" disabled={status === "sending"}>
              {status === "sending" ? t("sending") : t("send")}
            </Button>
          </form>

          <aside className="bg-slate-900 text-slate-300 rounded-3xl p-6 sm:p-7 shadow-xl shadow-slate-400/30 relative">
            <span className="w-11 h-11 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center mb-4">
              <IconMapPin size={22} />
            </span>
            <h2 className="font-extrabold text-white text-base mb-2">{t("addressTitle")}</h2>
            <p className="text-sm leading-relaxed whitespace-pre-line">{t("address")}</p>
          </aside>
        </div>
      </section>
    </main>
  );
}

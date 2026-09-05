"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { submitContactMessage } from "@/lib/api";

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
    <main className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-2">{t("title")}</h1>
      <p className="text-gray-600 mb-8">{t("subtitle")}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <form onSubmit={handleSubmit} className="md:col-span-2 flex flex-col gap-3">
          <label className="text-sm font-semibold text-gray-700">{t("nameLabel")}</label>
          <input
            type="text" required className="border rounded px-3 py-2"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label className="text-sm font-semibold text-gray-700">{t("emailLabel")}</label>
          <input
            type="email" required className="border rounded px-3 py-2"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <label className="text-sm font-semibold text-gray-700">{t("messageLabel")}</label>
          <textarea
            required rows={5} className="border rounded px-3 py-2"
            value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
          />

          {status === "success" && <p className="text-green-700 text-sm">{t("success")}</p>}
          {status === "error" && <p className="text-red-600 text-sm">{t("error")}</p>}

          <button type="submit" disabled={status === "sending"} className="bg-[#C9A227] text-[#1B2A4A] font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {status === "sending" ? t("sending") : t("send")}
          </button>
        </form>

        <div>
          <h2 className="text-sm font-semibold text-[#1B2A4A] mb-2">{t("addressTitle")}</h2>
          <p className="text-sm text-gray-600">{t("address")}</p>
        </div>
      </div>
    </main>
  );
}

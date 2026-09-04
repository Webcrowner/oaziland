"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { registerUser } from "@/lib/api";

/**
 * Registration — Page 4 of Prompt 17. A Client Component (needs
 * interactivity/form state) — Google/Facebook OAuth buttons are shown
 * but not yet wired to real credentials, consistent with how every
 * other "not yet connected" external integration in this project is
 * flagged rather than faked.
 */
export default function RegisterPage() {
  const t = useTranslations("RegisterPage");
  const router = useRouter();
  const [form, setForm] = useState({ username: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await registerUser(form);
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("registrationFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="max-w-sm mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-6">{t("title")}</h1>

        {/* Social login — UI present, NOT yet connected to real Google/
            Facebook credentials (Prompt 2's flag: still needs real
            OAuth app credentials from the founder). */}
        <div className="flex flex-col gap-2 mb-6">
          <button type="button" disabled className="border rounded px-4 py-2 text-sm text-gray-400 cursor-not-allowed">
            {t("continueWithGoogle")}
          </button>
          <button type="button" disabled className="border rounded px-4 py-2 text-sm text-gray-400 cursor-not-allowed">
            {t("continueWithFacebook")}
          </button>
        </div>

        <div className="text-center text-gray-400 text-sm mb-6">{t("orDivider")}</div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text" placeholder={t("usernamePlaceholder")} required
            className="border rounded px-3 py-2"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
          <input
            type="tel" placeholder={t("phonePlaceholder")} required
            className="border rounded px-3 py-2"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            type="password" placeholder={t("passwordPlaceholder")} required minLength={8}
            className="border rounded px-3 py-2"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="bg-[#1B2A4A] text-white font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? t("creatingAccount") : t("register")}
          </button>
        </form>
        <p className="text-sm text-gray-500 mt-4">{t("mfaNotice")}</p>
      </div>
    </main>
  );
}

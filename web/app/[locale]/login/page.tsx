"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { loginUser } from "@/lib/api";

export default function LoginPage() {
  const t = useTranslations("LoginPage");
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tokens = await loginUser(username, password);
      // Real JWT storage — a production build would use an httpOnly
      // cookie set server-side; localStorage is acceptable for this
      // stage but should be revisited before a production launch.
      localStorage.setItem("access_token", tokens.access);
      localStorage.setItem("refresh_token", tokens.refresh);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <div className="max-w-sm mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-[#1B2A4A] mb-6">{t("title")}</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text" placeholder={t("usernamePlaceholder")} required
            className="border rounded px-3 py-2"
            value={username} onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password" placeholder={t("passwordPlaceholder")} required
            className="border rounded px-3 py-2"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="bg-[#1B2A4A] text-white font-semibold py-2 rounded hover:opacity-90 disabled:opacity-50">
            {loading ? t("signingIn") : t("signIn")}
          </button>
        </form>
      </div>
    </main>
  );
}

"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { loginUser, getMyProfile, getDataAdminLink, ApiStatusError } from "@/lib/api";
import Button from "@/components/ui/Button";
import { IconUser, IconLock, IconEye, IconEyeOff, IconShield } from "@/components/Icons";

/** Set when the data admin (/admin/ on the backend) sent the visitor here to sign in. */
function dataAdminTarget(): { next?: string } | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("to") !== "data-admin") return null;
  const next = params.get("next") || "";
  return { next: next.startsWith("/admin/") && !next.includes("//") ? next : undefined };
}

export default function AdminLoginPage() {
  const t = useTranslations("AdminLoginPage");
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [handingOver, setHandingOver] = useState(false);

  /** Sends a signed-in admin on to the data admin. Returns false when the session can't be used. */
  async function goToDataAdmin(accessToken: string, next?: string): Promise<boolean> {
    try {
      window.location.href = await getDataAdminLink(accessToken, next);
      return true;
    } catch (err) {
      if (err instanceof ApiStatusError && err.status === 403) setError(t("dataAdminFullAccessOnly"));
      return false;
    }
  }

  // Already signed in to the console: go straight through to the data admin.
  useEffect(() => {
    const target = dataAdminTarget();
    const token = localStorage.getItem("access_token");
    if (!target || !token) return;
    void Promise.resolve().then(async () => {
      setHandingOver(true);
      if (!(await goToDataAdmin(token, target.next))) setHandingOver(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let tokens;
      try {
        tokens = await loginUser(username, password);
      } catch {
        setError(t("invalidCredentials"));
        return;
      }

      // Tokens are only kept if the account really is an admin.
      const profile = await getMyProfile(tokens.access);
      if (!profile.is_admin) {
        setError(t("notAdmin"));
        return;
      }

      localStorage.setItem("access_token", tokens.access);
      localStorage.setItem("refresh_token", tokens.refresh);
      const target = dataAdminTarget();
      if (target) {
        setHandingOver(true);
        if (!(await goToDataAdmin(tokens.access, target.next))) setHandingOver(false);
        return;
      }
      // Back to the console tab the admin was trying to open; only a plain tab name is passed on.
      const wanted = new URLSearchParams(window.location.search).get("tab");
      router.push(wanted && /^[a-z]{2,20}$/.test(wanted) ? `/admin?tab=${wanted}` : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("invalidCredentials"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-140px)] flex items-center justify-center py-12 px-4 sm:px-6 bg-slate-900 relative overflow-hidden">
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/10 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-10 right-10 w-80 h-80 bg-blue-600/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-rise-in">
        <div className="bg-white rounded-3xl p-7 sm:p-9 shadow-xl shadow-black/30 border border-slate-200/80">
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex justify-center mb-4 transition-transform hover:scale-105">
              <Image
                src="/logo.png"
                alt="Oaziland"
                width={120}
                height={120}
                style={{ width: "120px", height: "120px" }}
                priority
                className="object-contain drop-shadow-md"
              />
            </Link>
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-3">
                <IconShield size={13} />
                <span>{t("badge")}</span>
              </div>
            </div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {t("title")}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1.5">{t("subtitle")}</p>
          </div>

          {handingOver && (
            <p role="status" className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium text-center">
              {t("openingDataAdmin")}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="admin-username" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                {t("username")}
              </label>
              <div className="relative flex items-center">
                <IconUser size={16} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  id="admin-username"
                  type="text"
                  autoComplete="username"
                  placeholder={t("usernamePlaceholder")}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                {t("password")}
              </label>
              <div className="relative flex items-center">
                <IconLock size={16} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder={t("passwordPlaceholder")}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                {error}
              </div>
            )}

            <Button disabled={loading || handingOver} className="w-full py-3 rounded-xl text-sm font-bold shadow-md shadow-amber-500/20">
              {loading ? t("signingIn") : t("signIn")}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col items-center gap-3 text-xs text-slate-500">
            <span>{t("restrictedNote")}</span>
            <Link href="/" className="font-semibold text-amber-600 hover:text-amber-700">
              &larr; {t("backToSite")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

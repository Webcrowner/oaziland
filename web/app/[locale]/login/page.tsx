"use client";
import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { loginUser } from "@/lib/api";
import Button from "@/components/ui/Button";
import {
  IconUser,
  IconLock,
  IconEye,
  IconEyeOff,
  IconSparkles,
} from "@/components/Icons";

// Where a brand-new account lands first, based on what they chose at signup.
// Normal users (no entry here) still get the "what do you want to do" picker.
const ROLE_HOME: Record<string, string> = {
  landlord: "/landlord-portfolio",
  agent: "/dashboard",
  student: "/student-dashboard",
  technician: "/technician-dashboard",
  driver: "/driver-dashboard",
};

export default function LoginPage() {
  const t = useTranslations("LoginPage");
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const tokens = await loginUser(username, password);
      localStorage.setItem("access_token", tokens.access);
      localStorage.setItem("refresh_token", tokens.refresh);
      // If there's an explicit return URL (e.g. ?next=/dashboard or ?redirect=...), honor it
      const params = new URLSearchParams(window.location.search);
      const nextUrl = params.get("next") || params.get("redirect");

      if (nextUrl && nextUrl.startsWith("/")) {
        router.push(nextUrl);
      } else if (sessionStorage.getItem("oaziland_just_registered")) {
        sessionStorage.removeItem("oaziland_just_registered");
        const chosenRole = sessionStorage.getItem("oaziland_signup_role") || "renter";
        sessionStorage.removeItem("oaziland_signup_role");
        router.push(ROLE_HOME[chosenRole] ?? "/get-started");
      } else {
        // Direct returning users into their primary active workspace
        router.push("/renter-dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-140px)] flex items-center justify-center py-12 px-4 sm:px-6 bg-slate-50 relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/10 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute -bottom-10 right-10 w-80 h-80 bg-blue-600/10 blur-[100px] rounded-full pointer-events-none" />

      <div className="w-full max-w-md relative z-10 animate-rise-in">
        {/* Brand Card */}
        <div className="bg-white rounded-3xl p-7 sm:p-9 shadow-xl shadow-slate-200/60 border border-slate-200/80">
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex justify-center mb-4 transition-transform hover:scale-105">
              <Image
                src="/logo.png"
                alt="Oaziland"
                width={96}
                height={96}
                style={{ width: "96px", height: "96px" }}
                priority
                className="object-contain drop-shadow-md"
              />
            </Link>
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/70 text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-3">
                <IconSparkles size={13} className="text-amber-500" />
                <span>{t("portal")}</span>
              </div>
            </div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {t("title")}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
              {t("subtitle")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-sm font-semibold text-slate-700 mb-1.5">
                {t("usernamePlaceholder")}
              </label>
              <div className="relative flex items-center">
                <IconUser size={16} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  id="login-username"
                  autoComplete="username"
                  type="text"
                  placeholder={t("usernamePlaceholder")}
                  required
                  className="min-h-11 w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-3.5 py-2.5 text-base font-medium text-slate-800 placeholder:text-slate-500 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="block text-sm font-semibold text-slate-700">
                  {t("passwordPlaceholder")}
                </label>
                <Link href="/forgot-password" className="text-xs font-semibold text-amber-600 hover:text-amber-700">
                  {t("forgotPassword")}
                </Link>
              </div>
              <div className="relative flex items-center">
                <IconLock size={16} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  id="login-password"
                  autoComplete="current-password"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("passwordPlaceholder")}
                  required
                  className="min-h-11 w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-12 py-2.5 text-base font-medium text-slate-800 placeholder:text-slate-500 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 flex min-h-11 min-w-11 items-center justify-center text-slate-600 hover:text-slate-900 transition-colors"
                  aria-label={t(showPassword ? "hidePassword" : "showPassword")}
                >
                  {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
                {error}
              </div>
            )}

            <Button
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-bold shadow-md shadow-amber-500/20"
            >
              {loading ? t("signingIn") : t("signIn")}
            </Button>
          </form>

          <p className="text-xs text-slate-500 mt-5 text-center">
            {t("noAccountYet")}{" "}
            <Link
              href="/register"
              className="text-amber-600 font-bold hover:text-amber-700 transition-colors"
            >
              {t("createAccount")} &rarr;
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

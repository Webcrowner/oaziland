"use client";
import { useState, useEffect, Suspense } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { registerUser, SIGNUP_ROLES, type SignupRole } from "@/lib/api";
import Button from "@/components/ui/Button";
import {
  IconUser,
  IconLock,
  IconPhoneCall,
  IconEye,
  IconEyeOff,
  IconGoogle,
  IconFacebook,
  IconShieldCheck,
  IconSparkles,
} from "@/components/Icons";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const t = useTranslations("RegisterPage");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<{ username: string; phone: string; password: string; role: SignupRole }>({
    username: "", phone: "", password: "", role: "renter",
  });
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) setReferralCode(ref.toUpperCase());
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await registerUser({ ...form, ...(referralCode ? { referral_code: referralCode } : {}) });
      // Flags the very next login as a fresh signup, so LoginPage
      // knows to route into the real role/intent picker instead of
      // straight to the homepage — but only once, for this new account.
      sessionStorage.setItem("oaziland_just_registered", "1");
      sessionStorage.setItem("oaziland_signup_role", form.role);
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("registrationFailed"));
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
        <div className="bg-white rounded-3xl p-7 sm:p-9 shadow-xl shadow-slate-200/60 border border-slate-200/80">
          <div className="text-center mb-7">
            <Link href="/" className="inline-flex justify-center mb-4 transition-transform hover:scale-105">
              <Image
                src="/logo.png"
                alt="Oaziland"
                width={168}
                height={168}
                style={{ width: "168px", height: "168px" }}
                priority
                className="object-contain drop-shadow-md"
              />
            </Link>
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200/70 text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-3">
                <IconSparkles size={13} className="text-amber-500" />
                <span>Join Cameroon&apos;s Super-App</span>
              </div>
            </div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {t("title")}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
              Verified rentals, stays, rides &amp; artisan services across Cameroon
            </p>
          </div>

          {referralCode && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium mb-5">
              <IconShieldCheck size={16} className="text-emerald-600 shrink-0" />
              <span>{t("referralCodeApplied", { code: referralCode })}</span>
            </div>
          )}

          {/* Social Sign up */}
          <div className="space-y-2.5 mb-6">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold transition-all duration-200 shadow-sm active:scale-[0.99] group"
              onClick={() => alert("Google OAuth integration: Please configure Google Client ID in backend settings.")}
            >
              <IconGoogle size={18} className="shrink-0 transition-transform group-hover:scale-110" />
              <span>{t("continueWithGoogle")}</span>
            </button>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold transition-all duration-200 shadow-sm active:scale-[0.99] group"
              onClick={() => alert("Facebook Login integration: Please configure Facebook App ID in backend settings.")}
            >
              <IconFacebook size={18} className="shrink-0 transition-transform group-hover:scale-110" />
              <span>{t("continueWithFacebook")}</span>
            </button>
          </div>

          {/* Divider */}
          <div className="relative flex items-center justify-center mb-6">
            <div className="border-t border-slate-200 w-full" />
            <span className="bg-white px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 absolute">
              {t("orDivider")}
            </span>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Username <span className="text-red-500">*</span>
              </label>
              <div className="relative flex items-center">
                <IconUser size={16} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder={t("usernamePlaceholder")}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Cameroon Phone Number <span className="text-red-500">*</span>
              </label>
              <div className="relative flex items-center">
                <IconPhoneCall size={16} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="tel"
                  placeholder="+237 6..."
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                Password (min 8 characters) <span className="text-red-500">*</span>
              </label>
              <div className="relative flex items-center">
                <IconLock size={16} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder={t("passwordPlaceholder")}
                  required
                  minLength={8}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
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

            <div>
              <label htmlFor="signup-role" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                {t("roleLabel")}
              </label>
              <select
                id="signup-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as SignupRole })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
              >
                {SIGNUP_ROLES.map((role) => (
                  <option key={role} value={role}>{t(`role_${role}`)}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1.5">{t("roleHint")}</p>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                {error}
              </div>
            )}

            <Button
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-bold shadow-md shadow-amber-500/20"
            >
              {loading ? t("creatingAccount") : t("register")}
            </Button>
          </form>

          <p className="text-[11px] text-slate-500 mt-4 leading-relaxed text-center">
            {t("mfaNotice")}
          </p>

          <p className="text-xs text-slate-500 mt-5 text-center">
            {t("alreadyHaveAccount")}{" "}
            <Link
              href="/login"
              className="text-amber-600 font-bold hover:text-amber-700 transition-colors"
            >
              {t("signInInstead")} &rarr;
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

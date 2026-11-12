"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { dropTraining, enrollInTraining, getMyEnrollments, type TrainingEnrollmentItem, type TrainingProgram } from "@/lib/api";
import { currentPath, loginHref } from "@/lib/authRedirect";

export const BTN_PRIMARY = "rounded-xl bg-[var(--navy)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a] disabled:opacity-50";
const BTN_GHOST = "rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50";

const isPaid = (e?: TrainingEnrollmentItem) => Boolean(e?.payment?.escrow_status && e.payment.escrow_status !== "REFUNDED");
const isProcessing = (e?: TrainingEnrollmentItem) => e?.payment?.status === "PENDING" || e?.payment?.status === "PAYMENT_PROCESSING";

/** The signed-in learner's enrollments by program id. While a payment waits for approval on their phone it keeps
 * checking, so the course opens on its own once the payment is confirmed. */
export function useMyEnrollments() {
  const [enrollments, setEnrollments] = useState<Map<string, TrainingEnrollmentItem>>(new Map());
  const [loggedIn, setLoggedIn] = useState(false);

  const reload = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoggedIn(true);
    try {
      const data = await getMyEnrollments(token);
      setEnrollments(new Map(data.results.map((e) => [e.program, e])));
    } catch {
      // Keep showing the last known state; the next action will retry.
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => reload());
  }, [reload]);

  const awaitingApproval = [...enrollments.values()].some((e) => e.status === "PAYMENT_PENDING" && isProcessing(e));
  useEffect(() => {
    if (!awaitingApproval) return;
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, [awaitingApproval, reload]);

  return { enrollments, loggedIn, reload };
}

/** Everything a learner can do with one course from the outside: enroll (paying by Mobile Money if it has a price),
 * wait for the payment, open or drop it, and see their certificate once completed. */
export default function TrainingEnrollActions({
  program, enrollment, loggedIn, reload,
}: {
  program: TrainingProgram;
  enrollment: TrainingEnrollmentItem | undefined;
  loggedIn: boolean;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("TrainingPage");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [phone, setPhone] = useState("");

  // One runner for every action: keeps the buttons busy until the real server state has been reloaded (so a button
  // never flips back to its old label mid-action), and shows the server's own message when something fails.
  async function run(action: (token: string) => Promise<unknown>) {
    if (busy) return;
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push(loginHref(currentPath(pathname)));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await action(token);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("actionFailed"));
    }
    await reload();
    setBusy(false);
  }

  function enroll() {
    // A paid course asks for the Mobile Money number first, unless this learner already paid (and dropped).
    if (Number(program.price_xaf) > 0 && !isPaid(enrollment)) {
      if (!localStorage.getItem("access_token")) return router.push(loginHref(currentPath(pathname)));
      setError("");
      setPaying(true);
      return;
    }
    return run(async (token) => {
      const res = await enrollInTraining(program.id, token);
      // 409 = already enrolled elsewhere (e.g. another tab); reload() will sync it.
      if (!res.ok && res.status !== 409) throw new Error((await res.json().catch(() => ({}))).detail || "");
    });
  }

  function pay(e: React.FormEvent) {
    e.preventDefault();
    return run(async (token) => {
      const res = await enrollInTraining(program.id, token, phone.trim());
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "");
      setPaying(false);
    });
  }

  const payForm = (
    <form onSubmit={pay} className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-slate-700" htmlFor={`momo-${program.id}`}>{t("momoNumber")}</label>
      <input
        id={`momo-${program.id}`}
        type="tel"
        required
        autoFocus
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={t("momoPlaceholder")}
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <p className="text-[11px] leading-snug text-slate-500">{t("escrowNote")}</p>
      <button type="submit" disabled={busy || !phone.trim()} className={BTN_PRIMARY}>
        {busy ? t("paying") : t("payAmount", { amount: Number(program.price_xaf).toLocaleString(locale) })}
      </button>
      {paying && <button type="button" onClick={() => setPaying(false)} disabled={busy} className={BTN_GHOST}>{t("cancel")}</button>}
    </form>
  );

  let body: React.ReactNode;
  if (paying && (!enrollment || enrollment.status === "DROPPED")) {
    body = payForm;
  } else if (!enrollment || enrollment.status === "DROPPED") {
    body = (
      <div className="flex flex-col gap-2">
        {enrollment && <p className="text-center text-xs text-slate-500">{t("statusDropped")}</p>}
        <button onClick={enroll} disabled={busy} className={BTN_PRIMARY}>
          {!loggedIn ? t("signInToEnroll") : busy ? t("enrolling") : enrollment ? t("enrollAgain") : t("enroll")}
        </button>
      </div>
    );
  } else if (enrollment.status === "PAYMENT_PENDING") {
    body = isProcessing(enrollment) ? (
      <div className="flex flex-col gap-2 rounded-xl bg-amber-50 px-3 py-3 text-center">
        <p className="text-sm font-bold text-amber-900">
          📱 {t("approveOnPhone", { amount: Number(enrollment.payment?.amount_xaf ?? program.price_xaf).toLocaleString(locale) })}
        </p>
        <p className="text-[11px] text-amber-800">{t("approveOnPhoneHint")}</p>
        <button type="button" onClick={() => run(async () => {})} disabled={busy} className={BTN_GHOST}>
          {busy ? t("checking") : t("checkPayment")}
        </button>
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        <p className="text-center text-xs font-semibold text-red-700">{t("paymentFailed")}</p>
        {payForm}
      </div>
    );
  } else if (enrollment.status === "ENROLLED" || enrollment.status === "IN_PROGRESS") {
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-center text-xs font-semibold text-emerald-700">
          ✓ {enrollment.status === "IN_PROGRESS" ? t("statusInProgress") : t("statusEnrolled")}
        </p>
        <Link href={`/trainings/${program.id}/learn`} className={`${BTN_PRIMARY} text-center`}>
          {enrollment.status === "IN_PROGRESS" ? t("continueCourse") : t("openCourse")} →
        </Link>
        <p className="text-center text-[11px] text-slate-500">
          {program.lesson_count > 0 ? t("completesAutomatically") : t("trainerConfirms")}
        </p>
        {enrollment.payment?.escrow_status === "HELD" && (
          <Link href="/bookings" className="text-center text-[11px] text-slate-500 underline hover:text-slate-700">{t("requestRefund")}</Link>
        )}
        <button
          onClick={() => window.confirm(t("dropConfirm")) && run((token) => dropTraining(enrollment.id, token))}
          disabled={busy}
          className={BTN_GHOST}
        >
          {t("drop")}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-center">
        <p className="text-sm font-bold text-emerald-800">✓ {t("statusCompleted")}</p>
        {enrollment.certificate_code && (
          <Link
            href={`/certificates/${enrollment.certificate_code}`}
            className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            🏅 {t("viewCertificate")}
          </Link>
        )}
        <Link href={`/trainings/${program.id}/learn`} className="text-xs font-semibold text-[var(--navy)] underline">{t("reviewCourse")}</Link>
      </div>
    );
  }

  return (
    <div>
      {enrollment && !["DROPPED", "PAYMENT_PENDING"].includes(enrollment.status) && program.lesson_count > 0 && enrollment.progress && (
        <div className="mb-4">
          <div className="mb-1 text-[11px] font-medium text-slate-600">
            {t("progressLabel", { done: enrollment.progress.done, total: enrollment.progress.total, percent: enrollment.progress.percent })}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={enrollment.progress.percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all" style={{ width: `${enrollment.progress.percent}%` }} />
          </div>
        </div>
      )}
      {body}
      {error && <p role="alert" className="mt-2 text-center text-xs text-red-600">{error}</p>}
    </div>
  );
}

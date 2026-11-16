"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getPeerReviewQueue, openPeerSubmission, submitPeerReview, type PeerQueueItem } from "@/lib/api";

type Decision = "APPROVED" | "CHANGES_REQUESTED";
const MIN_CHANGES_CHARS = 10;

interface Props {
  enrollmentId: string;
  lessonId: string;
  handedIn: boolean;
  required: number;
  given: number;
  onReviewed: () => void;
}

/** A peer-reviewed assignment: once the learner has handed in their own work, they review a few anonymous classmates'. */
export default function PeerReviewPanel({ enrollmentId, lessonId, handedIn, required, given, onReviewed }: Props) {
  const t = useTranslations("CoursePlayer");
  const [items, setItems] = useState<PeerQueueItem[] | null>(null);
  const [decision, setDecision] = useState<Record<string, Decision>>({});
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [thanks, setThanks] = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !handedIn) return;
    try {
      setItems((await getPeerReviewQueue(enrollmentId, lessonId, token)).items);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }, [enrollmentId, lessonId, handedIn, t]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function send(item: PeerQueueItem) {
    const token = localStorage.getItem("access_token");
    const verdict = decision[item.id];
    if (!token || !verdict) return;
    setBusyId(item.id);
    setError("");
    try {
      await submitPeerReview(enrollmentId, item.id, verdict, feedback[item.id] ?? "", token);
      setThanks(true);
      onReviewed();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusyId("");
    }
  }

  async function open(item: PeerQueueItem) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await openPeerSubmission(enrollmentId, item.id, token);
    } catch {
      setError(t("actionFailed"));
    }
  }

  return (
    <section aria-labelledby="peer-review-title" className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
      <h3 id="peer-review-title" className="text-base font-bold text-violet-900">{t("peerTitle")}</h3>
      <p className="mt-1 text-sm text-violet-900/80">{t("peerIntro", { required })}</p>
      <p className="mt-1 text-xs text-violet-900/70">{t("peerPrivacy")}</p>

      {!handedIn ? (
        <p role="status" className="mt-4 rounded-lg bg-white p-3 text-sm text-slate-700">{t("peerHandInFirst")}</p>
      ) : (
        <>
          {given > 0 && <p className="mt-3 text-sm font-semibold text-violet-900">{t("peerGiven", { count: given })}</p>}
          {thanks && <p role="status" className="mt-2 text-sm font-semibold text-emerald-700">✓ {t("peerThanks")}</p>}
          {items === null ? (
            <p className="mt-4 text-sm text-slate-500">{t("loading")}</p>
          ) : items.length === 0 ? (
            <p className="mt-4 rounded-lg bg-white p-3 text-sm text-slate-600">{t("peerNothingToReview")}</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {items.map((item, index) => {
                const verdict = decision[item.id];
                const note = feedback[item.id] ?? "";
                const ready = verdict === "APPROVED" || (verdict === "CHANGES_REQUESTED" && note.trim().length >= MIN_CHANGES_CHARS);
                return (
                  <li key={item.id} className="rounded-xl border border-violet-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-semibold text-slate-900">{t("peerWork", { number: index + 1 })}</p>
                      <button type="button" onClick={() => open(item)} className="text-sm font-medium text-[var(--navy)] underline">{t("peerOpen")}</button>
                    </div>
                    <fieldset className="mt-3 flex flex-wrap gap-3 text-sm">
                      <legend className="sr-only">{t("peerVerdict")}</legend>
                      {(["APPROVED", "CHANGES_REQUESTED"] as Decision[]).map((value) => (
                        <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${verdict === value ? "border-[var(--navy)] bg-[var(--navy)]/[0.05]" : "border-slate-200"}`}>
                          <input type="radio" name={`peer-${item.id}`} checked={verdict === value} onChange={() => setDecision({ ...decision, [item.id]: value })} className="accent-[var(--navy)]" />
                          {t(value === "APPROVED" ? "peerApprove" : "peerChanges")}
                        </label>
                      ))}
                    </fieldset>
                    <textarea
                      value={note} onChange={(e) => setFeedback({ ...feedback, [item.id]: e.target.value })} rows={2} maxLength={2000}
                      placeholder={verdict === "CHANGES_REQUESTED" ? t("peerFeedbackRequired", { min: MIN_CHANGES_CHARS }) : t("peerFeedbackOptional")}
                      aria-label={t("peerFeedbackLabel")} className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button" onClick={() => send(item)} disabled={!ready || busyId === item.id}
                      className="mt-3 rounded-xl bg-[var(--navy)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#25396a] disabled:opacity-50"
                    >
                      {busyId === item.id ? t("peerSending") : t("peerSend")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}

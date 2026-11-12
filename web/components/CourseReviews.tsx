"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { deleteCourseReview, getCourseReviews, saveCourseReview, type CourseReviews as Reviews } from "@/lib/api";
import StarRating from "@/components/StarRating";

/** Ratings summary, the learner's own review (write / edit / delete) and everyone else's reviews. */
export default function CourseReviews({ programId }: { programId: string }) {
  const t = useTranslations("CourseReviews");
  const locale = useLocale();
  const [data, setData] = useState<Reviews | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await getCourseReviews(programId, localStorage.getItem("access_token")));
    } catch {
      setFailed(true);
    }
  }, [programId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function startEditing() {
    setScore(data?.my_review?.score ?? 0);
    setText(data?.my_review?.text ?? "");
    setError("");
    setEditing(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !score) return;
    setBusy(true);
    setError("");
    try {
      setData(await saveCourseReview(programId, score, text.trim(), token));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const token = localStorage.getItem("access_token");
    if (!token || !window.confirm(t("deleteConfirm"))) return;
    setBusy(true);
    try {
      setData(await deleteCourseReview(programId, token));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <p className="text-sm text-slate-500">{t("loadFailed")}</p>;
  if (!data) return <p className="text-sm text-slate-400">…</p>;

  const others = data.results.filter((r) => !r.is_mine);
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium" });

  return (
    <div>
      {data.count > 0 ? (
        <div className="mb-6 flex flex-col gap-6 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
          <div className="text-center sm:w-40">
            <p className="text-5xl font-black text-slate-900">{data.average?.toFixed(1)}</p>
            <StarRating value={data.average ?? 0} size="text-lg" />
            <p className="mt-1 text-xs text-slate-500">{t("reviewCount", { count: data.count })}</p>
          </div>
          <ul className="flex-1 space-y-1.5">
            {(["5", "4", "3", "2", "1"] as const).map((stars) => {
              const n = data.distribution[stars];
              const percent = data.count ? Math.round((n * 100) / data.count) : 0;
              return (
                <li key={stars} className="flex items-center gap-3 text-xs text-slate-600">
                  <span className="w-12 shrink-0">{t("starsLabel", { count: Number(stars) })}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="w-9 shrink-0 text-right">{percent}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mb-6 text-sm text-slate-500">{t("noReviews")}</p>
      )}

      {editing ? (
        <form onSubmit={submit} className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
          <p className="mb-2 text-sm font-semibold text-slate-800">{t("yourRating")}</p>
          <div className="mb-3 flex gap-1" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHovered(star)}
                onClick={() => setScore(star)}
                aria-label={t("starsLabel", { count: star })}
                aria-pressed={score === star}
                className={`text-3xl leading-none transition-colors ${star <= (hovered || score) ? "text-amber-500" : "text-slate-300"}`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder={t("textPlaceholder")}
            aria-label={t("textPlaceholder")}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy || !score} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              {busy ? t("saving") : data.my_review ? t("update") : t("submit")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600">
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : data.my_review ? (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-emerald-900">{t("yourReview")}</p>
            <div className="flex gap-3 text-xs font-semibold">
              <button onClick={startEditing} className="text-[var(--navy)] underline">{t("edit")}</button>
              <button onClick={remove} disabled={busy} className="text-red-600 underline">{t("delete")}</button>
            </div>
          </div>
          <StarRating value={data.my_review.score} />
          {data.my_review.text && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{data.my_review.text}</p>}
        </div>
      ) : data.can_review ? (
        <button onClick={startEditing} className="mb-6 rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#25396a]">
          ★ {t("writeReview")}
        </button>
      ) : data.cannot_review_reason === "not_started" ? (
        <p className="mb-6 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{t("reasonNotStarted")}</p>
      ) : null}

      <ul className="space-y-4">
        {others.map((review) => (
          <li key={review.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--navy)] text-sm font-bold text-white" aria-hidden>
                {review.author_name.charAt(0).toUpperCase()}
              </span>
              <span className="font-semibold text-slate-900">{review.author_name}</span>
              {review.completed && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">✓ {t("completedBadge")}</span>}
              <span className="ml-auto text-xs text-slate-400">{formatDate(review.updated_at)}</span>
            </div>
            <StarRating value={review.score} />
            {review.text && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{review.text}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

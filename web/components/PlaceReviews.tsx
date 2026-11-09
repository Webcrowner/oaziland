"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { addPlaceReview, getPlaceReviews, type PlaceReviewKind, type PlaceReviews as Reviews } from "@/lib/api";
import ReportContentButton from "@/components/ReportContentButton";

const stars = (score: number) => "★".repeat(score) + "☆".repeat(5 - score);

/** Reviews of a student hostel or event venue, with a form for people who stayed or held an event there. */
export default function PlaceReviews({ kind, id }: { kind: PlaceReviewKind; id: string }) {
  const t = useTranslations("PlaceReviews");
  const tRooms = useTranslations("HostelRooms");
  const locale = useLocale();
  const [data, setData] = useState<Reviews | null>(null);
  const [failed, setFailed] = useState(false);
  const [score, setScore] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let stale = false;
    getPlaceReviews(kind, id, localStorage.getItem("access_token"))
      .then((result) => { if (!stale) setData(result); })
      .catch(() => { if (!stale) setFailed(true); });
    return () => { stale = true; };
  }, [kind, id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (score < 1) {
      setError(t("pickScore"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      setData(await addPlaceReview(kind, id, score, text.trim(), token));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const detail = (value: string) => {
    if (!value) return "";
    if (kind === "venue") return t("eventOn", { date: new Date(value).toLocaleDateString(locale) });
    return tRooms.has(`unitType_${value}`) ? tRooms(`unitType_${value}`) : value;
  };

  return (
    <section className="mb-6" aria-labelledby={`reviews-${id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <h2 id={`reviews-${id}`} className="text-sm font-semibold text-gray-700">{t("title")}</h2>
        {data && data.count > 0 && data.average !== null && (
          <p className="text-sm text-gray-600">
            <span className="text-[var(--gold)]" aria-hidden="true">★</span>{" "}
            {t("summary", { average: data.average.toFixed(1), count: data.count })}
          </p>
        )}
      </div>

      {failed && <p className="text-sm text-gray-500">{t("loadFailed")}</p>}
      {!data && !failed && <p className="text-sm text-gray-500">{t("loading")}</p>}

      {data && (
        <>
          {data.results.length === 0 ? (
            <p className="text-sm text-gray-500 mb-3">{t(kind === "hostel" ? "emptyHostel" : "emptyVenue")}</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg mb-3">
              {data.results.map((review) => (
                <li key={review.id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <span className="text-[var(--gold)]" aria-label={t("starsLabel", { score: review.score })}>{stars(review.score)}</span>{" "}
                      <span className="font-semibold text-[var(--navy)]">{review.author_name}</span>
                      {review.detail && <span className="text-gray-500"> · {detail(review.detail)}</span>}
                    </p>
                    <span className="flex items-center gap-3">
                      <time className="text-xs text-gray-400" dateTime={review.created_at}>{new Date(review.created_at).toLocaleDateString(locale)}</time>
                      {!review.is_mine && (
                        <ReportContentButton kind={kind === "hostel" ? "hostel_review" : "venue_review"} id={review.id} ownerId={review.author_id} variant="inline" />
                      )}
                    </span>
                  </div>
                  {review.text && <p className="text-gray-700 mt-1 whitespace-pre-line break-words">{review.text}</p>}
                </li>
              ))}
            </ul>
          )}

          {saved && <p role="status" className="text-sm text-green-700 mb-2">✓ {t("thanks")}</p>}

          {data.can_review ? (
            <form onSubmit={submit} className="border border-gray-200 rounded-lg p-3 flex flex-col gap-2 bg-white">
              <fieldset>
                <legend className="text-sm font-semibold text-[var(--navy)] mb-1">{t(kind === "hostel" ? "writeHostel" : "writeVenue")}</legend>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setScore(value)}
                      aria-pressed={score === value}
                      aria-label={t("starsLabel", { score: value })}
                      className={`text-2xl leading-none cursor-pointer ${value <= score ? "text-[var(--gold)]" : "text-gray-300 hover:text-[var(--gold)]"}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </fieldset>
              <textarea
                rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={t("textPlaceholder")} aria-label={t("textPlaceholder")}
                className="border rounded px-2 py-1.5 text-sm"
              />
              {error && <p role="alert" className="text-red-600 text-xs">{error}</p>}
              <button type="submit" disabled={busy} className="self-start bg-[var(--navy)] text-white text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50 cursor-pointer">
                {busy ? t("saving") : t("submit")}
              </button>
            </form>
          ) : (
            data.cannot_review_reason === "sign_in" && (
              <p className="text-xs text-gray-500">
                <Link href="/login" className="underline hover:text-[var(--clay)]">{t("signIn")}</Link> {t(kind === "hostel" ? "whoHostel" : "whoVenue")}
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}

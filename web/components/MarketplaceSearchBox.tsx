"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getMarketplaceSearchAssist, getTrendingMarketplaceSearches, searchMarketplaceByImage, VisualSearchError } from "@/lib/api";
import { clearRecentSearches, loadRecentSearches, saveRecentSearch, speechLang } from "@/lib/recentSearches";
import {
  ASSIST_DEBOUNCE_MS, ASSIST_MIN_CHARS, getSpeechRecognition, imageProblem, suggestionFor, transcriptOf,
  type SpeechRecognitionLike,
} from "@/lib/searchAssist";

const iconButton = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50 cursor-pointer";

/** The marketplace search box with search assist: spelling suggestion, recent and trending searches, voice and photo search. */
export default function MarketplaceSearchBox({ value, onChange, className = "" }: { value: string; onChange: (q: string) => void; className?: string }) {
  const t = useTranslations("SearchAssist");
  const locale = useLocale();
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [trending, setTrending] = useState<string[]>([]);
  const [assist, setAssist] = useState<{ query: string; did_you_mean: string | null } | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const trendingLoaded = useRef(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVoiceSupported(getSpeechRecognition() !== null), 0);
    return () => {
      clearTimeout(timer);
      recognition.current?.abort();
    };
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q.length < ASSIST_MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getMarketplaceSearchAssist(q, controller.signal).then(setAssist).catch(() => {});
    }, ASSIST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  function handleFocus() {
    setFocused(true);
    setRecent(loadRecentSearches());
    if (!trendingLoaded.current) {
      trendingLoaded.current = true;
      getTrendingMarketplaceSearches().then((rows) => setTrending(rows.map((row) => row.term).slice(0, 8))).catch(() => {});
    }
  }

  function apply(term: string) {
    onChange(term);
    saveRecentSearch(term);
    setNotice("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    saveRecentSearch(value);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function startVoice() {
    const Recognizer = getSpeechRecognition();
    if (!Recognizer) return;
    if (listening) {
      recognition.current?.stop();
      return;
    }
    setNotice("");
    const instance = new Recognizer();
    instance.lang = speechLang(locale);
    instance.interimResults = false;
    instance.maxAlternatives = 1;
    instance.onresult = (event) => {
      const text = transcriptOf(event);
      if (text) apply(text);
      else setNotice(t("voiceNoSpeech"));
    };
    instance.onerror = (event) => {
      setNotice(event.error === "not-allowed" || event.error === "service-not-allowed" ? t("voiceDenied") : event.error === "no-speech" ? t("voiceNoSpeech") : t("voiceFailed"));
    };
    instance.onend = () => setListening(false);
    recognition.current = instance;
    try {
      instance.start();
      setListening(true);
    } catch {
      setNotice(t("voiceFailed"));
    }
  }

  async function searchByPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) {
      setNotice(problem === "type" ? t("photoType") : t("photoTooLarge"));
      return;
    }
    setPhotoBusy(true);
    setNotice("");
    try {
      const result = await searchMarketplaceByImage(file);
      if (result.q.trim()) apply(result.q.trim());
      else setNotice(t("photoNoMatch"));
    } catch (err) {
      setNotice(err instanceof VisualSearchError && err.unavailable ? t("photoUnavailable") : t("photoFailed"));
    } finally {
      setPhotoBusy(false);
    }
  }

  const suggestion = suggestionFor(value, assist);
  const showPanel = focused && value.trim() === "" && (recent.length > 0 || trending.length > 0);
  const chip = "inline-flex min-h-10 max-w-full items-center rounded-full border border-slate-300 bg-white px-3.5 text-sm text-slate-700 hover:border-[var(--navy)] cursor-pointer";

  return (
    <div
      className={`relative ${className}`}
      onFocus={handleFocus}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
    >
      <form onSubmit={submit} className="flex items-center rounded-xl border border-slate-300 bg-white pr-1 focus-within:border-[var(--gold)]">
        <input
          type="search" value={value} onChange={(e) => onChange(e.target.value)} enterKeyHint="search" autoComplete="off"
          placeholder={t("placeholder")} aria-label={t("placeholder")}
          className="min-h-11 min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2.5 text-sm focus:outline-none"
        />
        {voiceSupported && (
          <button type="button" onClick={startVoice} aria-pressed={listening} aria-label={listening ? t("voiceStop") : t("voiceStart")} className={`${iconButton} ${listening ? "animate-pulse bg-red-50 text-red-600" : ""}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
            </svg>
          </button>
        )}
        <button type="button" onClick={() => fileInput.current?.click()} disabled={photoBusy} aria-label={t("photoSearch")} className={iconButton}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
        </button>
        <input ref={fileInput} type="file" accept="image/*" capture="environment" onChange={searchByPhoto} className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {recent.length > 0 && (
            <section aria-label={t("recentTitle")}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("recentTitle")}</h3>
                <button type="button" onClick={() => { clearRecentSearches(); setRecent([]); }} className="min-h-10 px-1 text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("recentClear")}</button>
              </div>
              <ul className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <li key={term} className="max-w-full">
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(term)} className={chip}><span className="truncate">{term}</span></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {trending.length > 0 && (
            <section aria-label={t("trendingTitle")}>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{t("trendingTitle")}</h3>
              <ul className="flex flex-wrap gap-2">
                {trending.map((term) => (
                  <li key={term} className="max-w-full">
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(term)} className={chip}><span className="truncate">🔥 {term}</span></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <div aria-live="polite" className="empty:hidden">
        {listening && <p className="mt-1.5 text-sm font-medium text-red-600">{t("listening")}</p>}
        {photoBusy && <p className="mt-1.5 text-sm font-medium text-slate-600">{t("photoSearching")}</p>}
        {notice && !listening && !photoBusy && <p className="mt-1.5 text-sm text-amber-800">{notice}</p>}
        {suggestion && !listening && !photoBusy && (
          <p className="mt-1.5 text-sm text-slate-700">
            {t("didYouMean")}{" "}
            <button type="button" onClick={() => apply(suggestion)} className="min-h-10 font-bold text-[var(--navy)] underline cursor-pointer">{suggestion}</button>
            ?
          </p>
        )}
      </div>
    </div>
  );
}

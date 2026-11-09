"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AdminKycReviewItem } from "@/lib/api";

type DocKey = "front" | "back" | "selfie";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A date-only string (YYYY-MM-DD) shown as a date, without the time-zone shift `new Date("…")` would cause. */
function formatBirthDate(value: string, locale: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(year, month - 1, day));
}

function relativeTime(iso: string, locale: string, now: number): string {
  const diff = new Date(iso).getTime() - now;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(diff / 3600000);
  if (Math.abs(hours) < 48) return formatter.format(hours, "hour");
  return formatter.format(Math.round(diff / DAY_MS), "day");
}

function initials(name: string): string {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || "?").toUpperCase();
}

function Chip({ tone, children }: { tone: "good" | "bad" | "warn" | "muted"; children: React.ReactNode }) {
  const styles = {
    good: "bg-emerald-50 text-emerald-800 border-emerald-200",
    bad: "bg-rose-50 text-rose-800 border-rose-200",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    muted: "bg-slate-100 text-slate-600 border-slate-200",
  }[tone];
  const mark = { good: "✓", bad: "!", warn: "!", muted: "–" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${styles}`}>
      <span aria-hidden>{mark}</span>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-3 py-1.5 text-sm sm:grid-cols-[9rem_1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400 pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-900">{children}</dd>
    </div>
  );
}

function Lightbox({
  docs, index, onIndex, onClose,
}: {
  docs: { key: DocKey; label: string; url: string }[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("AdminConsolePage");
  const closeRef = useRef<HTMLButtonElement>(null);
  const doc = docs[index];

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex((index + 1) % docs.length);
      else if (e.key === "ArrowLeft") onIndex((index - 1 + docs.length) % docs.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, docs.length, onIndex, onClose]);

  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col bg-slate-950/90 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label={doc.label}
    >
      <div className="flex items-center justify-between gap-3 text-white">
        <p className="text-sm font-bold">{doc.label} <span className="ml-2 text-xs font-medium text-white/60">{index + 1} / {docs.length}</span></p>
        <div className="flex items-center gap-2">
          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20">{t("kycOpenOriginal")} ↗</a>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20 cursor-pointer">{t("kycClose")}</button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center pt-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {docs.length > 1 && (
          <button type="button" aria-label={t("kycPrev")} onClick={() => onIndex((index - 1 + docs.length) % docs.length)}
            className="absolute left-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-xl text-white hover:bg-white/30 cursor-pointer">‹</button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={doc.url} alt={doc.label} className="max-h-full max-w-full rounded-lg object-contain" />
        {docs.length > 1 && (
          <button type="button" aria-label={t("kycNext")} onClick={() => onIndex((index + 1) % docs.length)}
            className="absolute right-0 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-xl text-white hover:bg-white/30 cursor-pointer">›</button>
        )}
      </div>
    </div>
  );
}

function DocThumb({ label, url, onOpen }: { label: string; url: string; onOpen: () => void }) {
  const t = useTranslations("AdminConsolePage");
  const [failed, setFailed] = useState(false);

  if (!url) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/50 text-center">
        <span className="text-xs font-bold text-rose-700">{label}</span>
        <span className="mt-0.5 text-[11px] text-rose-600">{t("kycNotProvided")}</span>
      </div>
    );
  }
  return (
    <button
      type="button" onClick={onOpen} aria-label={`${label} — ${t("kycEnlarge")}`}
      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left focus-visible:outline-2 focus-visible:outline-amber-400 cursor-zoom-in"
    >
      {failed ? (
        <span className="flex h-full flex-col items-center justify-center px-2 text-center text-[11px] font-semibold text-slate-500">{t("kycPreviewFailed")}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6 text-[11px] font-bold text-white">{label}</span>
    </button>
  );
}

/** One identity (KYC) submission laid out for review: who applied, what they submitted, the documents to check it against. */
export default function AdminKycReviewCard({
  item, onApprove, onReject,
}: {
  item: AdminKycReviewItem;
  onApprove: (item: AdminKycReviewItem) => void;
  onReject: (item: AdminKycReviewItem) => void;
}) {
  const t = useTranslations("AdminConsolePage");
  const locale = useLocale();
  const [zoom, setZoom] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  // Read once when the card appears, so "submitted 2 days ago" doesn't depend on the clock during render.
  const [now] = useState(() => Date.now());

  const docs: { key: DocKey; label: string; url: string }[] = [
    { key: "front", label: t("kycDocFront"), url: item.id_document_front_image_url },
    { key: "back", label: t("kycDocBack"), url: item.id_document_back_image_url },
    { key: "selfie", label: t("kycDocSelfie"), url: item.selfie_image_url },
  ];
  const available = docs.filter((d) => d.url);
  const missing = docs.length - available.length;

  const waitingMs = now - new Date(item.submitted_at).getTime();
  const longWait = waitingMs > 2 * DAY_MS;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  const copyId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.national_id_number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; the number stays selectable on screen.
    }
  }, [item.national_id_number]);

  const underage = item.age !== null && item.age < 18;

  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-amber-300" aria-hidden>
            {initials(item.legal_full_name)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-900">{item.legal_full_name}</h3>
            <p className="truncate text-xs text-slate-500">@{item.username}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-xs font-bold ${longWait ? "text-amber-700" : "text-slate-600"}`}>
            {longWait && <span aria-hidden>⏱ </span>}{t("kycSubmitted", { when: relativeTime(item.submitted_at, locale, now) })}
          </p>
          <p className="text-[11px] text-slate-400">{dateTime.format(new Date(item.submitted_at))}</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 px-5 pt-4" aria-label={t("kycChecks")}>
        {item.age === null ? (
          <Chip tone="warn">{t("kycAgeUnknown")}</Chip>
        ) : underage ? (
          <Chip tone="bad">{t("kycUnderage", { age: item.age })}</Chip>
        ) : (
          <Chip tone="good">{t("kycAge", { age: item.age })}</Chip>
        )}
        {item.duplicate_id_count > 0 ? (
          <Chip tone="bad">{t("kycIdDuplicate", { count: item.duplicate_id_count })}</Chip>
        ) : (
          <Chip tone="good">{t("kycIdUnique")}</Chip>
        )}
        {item.name_matches_account === null ? (
          <Chip tone="muted">{t("kycNameUnchecked")}</Chip>
        ) : item.name_matches_account ? (
          <Chip tone="good">{t("kycNameMatches")}</Chip>
        ) : (
          <Chip tone="warn">{t("kycNameDiffers")}</Chip>
        )}
        {missing > 0 && <Chip tone="bad">{t("kycMissingDocs", { count: missing })}</Chip>}
      </div>

      <div className="grid gap-6 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <section>
            <h4 className="mb-1 text-[11px] font-black uppercase tracking-widest text-amber-700">{t("kycSectionIdentity")}</h4>
            <dl className="divide-y divide-slate-100">
              <Field label={t("kycLegalName")}>{item.legal_full_name}</Field>
              <Field label={t("kycDob")}>
                {formatBirthDate(item.date_of_birth, locale)}
                {item.age !== null && <span className="ml-1.5 text-xs font-semibold text-slate-400">({t("kycYears", { age: item.age })})</span>}
              </Field>
              <Field label={t("kycIdNumber")}>
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[13px] tracking-wide select-all">{item.national_id_number}</span>
                  <button type="button" onClick={copyId} className="text-xs font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer">
                    {copied ? t("kycCopied") : t("kycCopy")}
                  </button>
                </span>
              </Field>
              <Field label={t("kycAddress")}>{item.residential_address}</Field>
            </dl>
          </section>

          <section>
            <h4 className="mb-1 text-[11px] font-black uppercase tracking-widest text-slate-500">{t("kycSectionAccount")}</h4>
            <dl className="divide-y divide-slate-100">
              <Field label={t("kycAccountName")}>
                {item.full_name || <span className="font-normal text-slate-400">{t("kycNoName")}</span>}
              </Field>
              <Field label={t("kycPhone")}>
                {item.phone ? <a href={`tel:${item.phone}`} className="hover:underline">{item.phone}</a> : <span className="font-normal text-slate-400">—</span>}
              </Field>
              <Field label={t("kycEmail")}>
                {item.email ? <a href={`mailto:${item.email}`} className="hover:underline">{item.email}</a> : <span className="font-normal text-slate-400">—</span>}
              </Field>
              <Field label={t("kycMemberSince")}>{dateTime.format(new Date(item.date_joined))}</Field>
            </dl>
          </section>
        </div>

        <section>
          <h4 className="mb-2 text-[11px] font-black uppercase tracking-widest text-amber-700">{t("kycSectionDocuments")}</h4>
          <div className="grid grid-cols-2 gap-3">
            {docs.slice(0, 2).map((doc) => (
              <DocThumb key={doc.key} label={doc.label} url={doc.url} onOpen={() => setZoom(available.findIndex((d) => d.key === doc.key))} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <DocThumb label={docs[2].label} url={docs[2].url} onOpen={() => setZoom(available.findIndex((d) => d.key === "selfie"))} />
            <p className="self-center text-[11px] leading-relaxed text-slate-400">{t("kycDocsHint")}</p>
          </div>
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
        <button
          type="button" onClick={() => onReject(item)}
          className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
        >
          {t("reject")}
        </button>
        <button
          type="button" onClick={() => onApprove(item)}
          className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition-colors cursor-pointer"
        >
          {t("approve")}
        </button>
      </footer>

      {zoom !== null && zoom >= 0 && available.length > 0 && (
        <Lightbox docs={available} index={zoom} onIndex={setZoom} onClose={() => setZoom(null)} />
      )}
    </article>
  );
}

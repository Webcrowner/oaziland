"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyTrainerProfile, saveMyTrainerProfile, type MyTrainerProfile } from "@/lib/api";

/** Lets a trainer write the headline, bio and website shown on their public trainer page. */
export default function TrainerProfileEditor() {
  const t = useTranslations("TrainerProfile");
  const [profile, setProfile] = useState<MyTrainerProfile | null>(null);
  const [form, setForm] = useState({ headline: "", bio: "", website: "" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyTrainerProfile(token)
      .then((data) => {
        setProfile(data);
        setForm({ headline: data.headline, bio: data.bio, website: data.website });
      })
      .catch(() => {});
  }, []);

  if (!profile?.is_trainer) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      setProfile(await saveMyTrainerProfile({ headline: form.headline.trim(), bio: form.bio.trim(), website: form.website.trim() }, token));
      setMessage({ ok: true, text: t("saved") });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("saveFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="font-bold text-slate-900">👤 {t("yourProfile")}</h2>
          <p className="text-sm text-slate-500">{t("yourProfileHint")}</p>
        </div>
        <Link href={`/trainers/${profile.id}`} className="text-sm font-semibold text-[var(--navy)] underline">{t("viewPublicPage")}</Link>
        {!open && (
          <button onClick={() => setOpen(true)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {t("edit")}
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={save} className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">{t("headline")}</span>
            <input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} maxLength={160} placeholder={t("headlinePlaceholder")} className="rounded-lg border px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">{t("bio")}</span>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={3000} rows={6} placeholder={t("bioPlaceholder")} className="rounded-lg border px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">{t("website")}</span>
            <input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" className="rounded-lg border px-3 py-2" />
          </label>
          {message && <p role="status" className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>{message.text}</p>}
          <div className="flex gap-2">
            <button disabled={busy} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? t("saving") : t("save")}</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border px-4 py-2.5 text-sm">{t("close")}</button>
          </div>
        </form>
      )}
    </section>
  );
}

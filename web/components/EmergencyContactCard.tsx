"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getMyEmergencyContactState, saveMyEmergencyContact, deleteMyEmergencyContact, type EmergencyContact } from "@/lib/api";

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";

/** The person to alert when this user presses SOS on a ride. One contact, set and removed by the user. */
export default function EmergencyContactCard() {
  const t = useTranslations("EmergencyContact");
  const [saved, setSaved] = useState<EmergencyContact | null>(null);
  const [smsLive, setSmsLive] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyEmergencyContactState(token)
      .then((state) => {
        setSaved(state.contact);
        setSmsLive(state.smsDeliveryLive);
      })
      .catch(() => {});
  }, []);

  function startEdit() {
    setName(saved?.name ?? "");
    setPhone(saved?.phone ?? "");
    setError("");
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const updated = await saveMyEmergencyContact({ name: name.trim(), phone: phone.trim() }, token);
      setSaved(updated);
      if (typeof updated.sms_delivery_live === "boolean") {
        setSmsLive(updated.sms_delivery_live);
      }
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await deleteMyEmergencyContact(token);
      setSaved(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-sm mb-6">
      <h2 className="text-base font-black tracking-tight text-slate-900">{t("title")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("explainer")}</p>
      {!smsLive && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          {t("smsNotConnected")}
        </p>
      )}
      {editing ? (
        <form onSubmit={save} className="mt-4 flex flex-col gap-2">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} aria-label={t("namePlaceholder")} maxLength={200} className={inputCls} />
          <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("phonePlaceholder")} aria-label={t("phonePlaceholder")} maxLength={20} className={inputCls} />
          {error && <p className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer">{t("save")}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">{t("cancel")}</button>
          </div>
        </form>
      ) : saved ? (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm">
          <span className="font-bold text-slate-900">{saved.name}</span>
          <span className="font-mono text-xs text-slate-500">{saved.phone}</span>
          <span className="ml-auto flex items-center gap-2">
            <button onClick={startEdit} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">{t("change")}</button>
            <button onClick={remove} className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors cursor-pointer">{t("remove")}</button>
          </span>
          {error && <span className="w-full text-xs text-red-700">{error}</span>}
        </div>
      ) : (
        <button onClick={startEdit} className="mt-4 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">{t("add")}</button>
      )}
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getMyEmergencyContact, saveMyEmergencyContact, deleteMyEmergencyContact, type EmergencyContact } from "@/lib/api";

/** The person to alert when this user presses SOS on a ride. One contact, set and removed by the user. */
export default function EmergencyContactCard() {
  const t = useTranslations("EmergencyContact");
  const [saved, setSaved] = useState<EmergencyContact | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyEmergencyContact(token).then(setSaved).catch(() => {});
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
      setSaved(await saveMyEmergencyContact({ name: name.trim(), phone: phone.trim() }, token));
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
    <section className="border border-gray-200 rounded-xl p-4 bg-white mb-6">
      <h2 className="font-bold text-[var(--navy)] mb-1">{t("title")}</h2>
      <p className="text-xs text-gray-600 mb-3">{t("explainer")}</p>
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-2">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} aria-label={t("namePlaceholder")} maxLength={200} className="border rounded-lg px-3 py-2 text-sm" />
          <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("phonePlaceholder")} aria-label={t("phonePlaceholder")} maxLength={20} className="border rounded-lg px-3 py-2 text-sm" />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-3 items-center">
            <button type="submit" disabled={busy} className="bg-[var(--navy)] text-white font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-50 cursor-pointer">{t("save")}</button>
            <button type="button" onClick={() => setEditing(false)} className="text-sm text-gray-500 underline cursor-pointer">{t("cancel")}</button>
          </div>
        </form>
      ) : saved ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-slate-800">{saved.name}</span>
          <span className="text-slate-600">{saved.phone}</span>
          <button onClick={startEdit} className="text-[var(--navy)] underline cursor-pointer">{t("change")}</button>
          <button onClick={remove} className="text-red-700 underline cursor-pointer">{t("remove")}</button>
          {error && <span className="text-red-700">{error}</span>}
        </div>
      ) : (
        <button onClick={startEdit} className="text-sm font-semibold text-[var(--navy)] underline cursor-pointer">{t("add")}</button>
      )}
    </section>
  );
}

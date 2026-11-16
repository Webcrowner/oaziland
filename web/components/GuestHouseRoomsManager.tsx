"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { listMyGuestHouses, setGuestHouseName, type GuestHouse } from "@/lib/api";
import HotelRoomTypesEditor from "@/components/HotelRoomTypesEditor";
import StaysPanel from "@/components/StaysPanel";
import ChannelCalendarsPanel from "@/components/ChannelCalendarsPanel";

const field = "rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-amber-400 focus:outline-none";

/** The host's guest houses: pick one, name it, and set up the rooms guests book on its page. */
export default function GuestHouseRoomsManager({ userId }: { userId: string }) {
  const t = useTranslations("GuestHouseRoomsManager");
  const [houses, setHouses] = useState<GuestHouse[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = houses.find((h) => h.id === selectedId) ?? null;

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    listMyGuestHouses(token)
      .then((mine) => {
        setHouses(mine);
        if (mine[0]) {
          setSelectedId(mine[0].id);
          setNameDraft(mine[0].name || "");
        }
      })
      .catch(() => setHouses([]));
  }, [userId]);

  function select(id: string) {
    setSelectedId(id);
    setNameDraft(houses.find((h) => h.id === id)?.name || "");
    setMessage("");
  }

  function replace(updated: GuestHouse) {
    setHouses((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !selected || !nameDraft.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      replace(await setGuestHouseName(selected.id, nameDraft.trim(), token));
      setMessage(t("nameSaved"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("failed"));
    } finally {
      setSaving(false);
    }
  }

  if (!selected) return null;

  return (
    <section className="mt-6 space-y-4" aria-labelledby="guest-house-rooms-heading">
      <StaysPanel mode="host" place="guest_house" />
      <h2 id="guest-house-rooms-heading" className="text-lg font-bold text-slate-900">{t("title")}</h2>
      <div className="flex flex-wrap items-end gap-4">
        {houses.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">
            {t("selectLabel")}
            <select value={selectedId} onChange={(e) => select(e.target.value)} className={field}>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.name ? `${h.name} (${h.quarter_name})` : h.quarter_name}</option>
              ))}
            </select>
          </label>
        )}
        <form onSubmit={saveName} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">
            {t("nameLabel")}
            <input value={nameDraft} maxLength={200} onChange={(e) => setNameDraft(e.target.value)} placeholder={t("namePlaceholder")} className={field} />
          </label>
          <button type="submit" disabled={saving || !nameDraft.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {t("saveName")}
          </button>
          {message && <span role="status" className="text-xs font-semibold text-emerald-700">{message}</span>}
        </form>
      </div>
      <HotelRoomTypesEditor key={selected.id} hotel={selected} onChange={replace} endpoint="guest-houses" />
      <ChannelCalendarsPanel key={`cal-${selected.id}`} guestHouseId={selected.id} />
      <Link href={`/guest-houses/${selected.id}`} className="inline-flex text-xs font-bold text-amber-700 hover:text-amber-800">
        {t("viewGuestPage")} →
      </Link>
    </section>
  );
}

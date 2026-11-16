"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  addRoomTypePhoto, deleteRoomType, removeRoomTypePhoto, saveRoomType, setRoomTypeVisibility,
  type RoomTypePlaceEndpoint, type RoomTypeSummary,
} from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

const CATEGORIES = ["STANDARD", "DELUXE", "SUITE", "EXECUTIVE", "FAMILY", "ACCESSIBLE"];
const field = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none";
const label = "flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500";

const EMPTY_FORM = {
  name: "", category: "STANDARD", capacity: "2", base_rate_xaf: "", room_count: "1", bed_setup: "", size_sqm: "",
  amenities: "", description: "",
};
type Form = typeof EMPTY_FORM;

type Place = { id: string; room_types: RoomTypeSummary[] };

/** The owner's side of a hotel's or guest house's page: each room or unit type guests book (name, nightly rate,
 * photos, how many identical rooms of it there are). Guests see one card per type and book it for their dates. */
export default function HotelRoomTypesEditor<T extends Place>({
  hotel, onChange, endpoint = "hotels",
}: { hotel: T; onChange: (place: T) => void; endpoint?: RoomTypePlaceEndpoint }) {
  const t = useTranslations("HotelRoomTypesEditor");
  const locale = useLocale();
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const money = (value: string) => new Intl.NumberFormat(locale).format(Number(value));

  async function run(action: (token: string) => Promise<T>, success: string, after?: () => void) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setMessage(null);
    try {
      onChange(await action(token));
      setMessage({ ok: true, text: success });
      after?.();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("failed") });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(roomType: RoomTypeSummary) {
    setEditingId(roomType.id);
    setForm({
      name: roomType.name, category: roomType.category, capacity: String(roomType.capacity),
      base_rate_xaf: String(Math.round(Number(roomType.base_rate_xaf))), room_count: String(roomType.total_rooms ?? roomType.room_count),
      bed_setup: roomType.bed_setup ?? "", size_sqm: roomType.size_sqm ? String(Number(roomType.size_sqm)) : "",
      amenities: (roomType.amenities ?? []).join(", "), description: roomType.description ?? "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm" aria-labelledby="hotel-room-types-heading">
      <div>
        <h3 id="hotel-room-types-heading" className="text-sm font-bold text-slate-900">{t("title")}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t("intro")}</p>
      </div>

      {message && (
        <p role="status" className={`rounded-xl px-3 py-2 text-xs font-semibold ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {message.text}
        </p>
      )}

      {hotel.room_types.length === 0 ? (
        <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {hotel.room_types.map((roomType) => {
            const active = roomType.is_active !== false;
            return (
              <li key={roomType.id} className={`rounded-xl border p-4 ${active ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-black text-slate-900">{roomType.name}</p>
                    <p className="text-sm font-bold text-amber-700">{t("perNight", { price: money(roomType.base_rate_xaf) })}</p>
                    <p className="text-xs text-slate-500">
                      {t("sleeps", { count: roomType.capacity })} · {t("rooms", { count: roomType.total_rooms ?? roomType.room_count })}
                    </p>
                    {!active && <p className="mt-1 text-xs font-bold text-slate-600">{t("hiddenFromGuests")}</p>}
                    {active && roomType.room_count < 1 && <p className="mt-1 text-xs font-bold text-amber-700">{t("noRoomsWarning")}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                    <button type="button" disabled={busy} onClick={() => startEdit(roomType)} className="text-slate-600 hover:text-slate-900">{t("edit")}</button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run((token) => setRoomTypeVisibility<T>(endpoint, hotel.id, roomType.id, !active, token), active ? t("hidden") : t("shown"))}
                      className="text-slate-600 hover:text-slate-900"
                    >
                      {active ? t("hide") : t("show")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(t("confirmDelete", { name: roomType.name }))) {
                          void run((token) => deleteRoomType<T>(endpoint, hotel.id, roomType.id, token), t("deleted"));
                        }
                      }}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      {t("delete")}
                    </button>
                  </div>
                </div>

                <ul className="mt-3 flex flex-wrap gap-2">
                  {roomType.photos.map((photo, index) => (
                    <li key={photo.id} className="relative h-16 w-20 overflow-hidden rounded-lg border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt={t("photoAlt", { name: roomType.name, number: index + 1 })} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t("removePhoto", { number: index + 1 })}
                        onClick={() => run((token) => removeRoomTypePhoto<T>(endpoint, hotel.id, roomType.id, photo.id, token), t("photoRemoved"))}
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-xs text-white hover:bg-slate-900"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2">
                  <MediaUploader
                    folder={endpoint}
                    accept="image/*"
                    label={t("addPhotos")}
                    onUploaded={(media) => void run((token) => addRoomTypePhoto<T>(endpoint, hotel.id, roomType.id, media.url, token), t("photoAdded"))}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            (token) => saveRoomType<T>(endpoint, hotel.id, {
              name: form.name, category: form.category, capacity: Number(form.capacity), base_rate_xaf: form.base_rate_xaf,
              room_count: Number(form.room_count), bed_setup: form.bed_setup, size_sqm: form.size_sqm || null,
              description: form.description, amenities: form.amenities.split(",").map((a) => a.trim()).filter(Boolean),
              ...(editingId ? { room_type: editingId } : {}),
            }, token),
            editingId ? t("updated") : t("created"),
            resetForm,
          );
        }}
        className="space-y-3 border-t border-slate-100 pt-4"
        aria-label={editingId ? t("editTitle") : t("createTitle")}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-slate-700">{editingId ? t("editTitle") : t("createTitle")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${label} min-w-[16rem] grow`}>
            {t("nameLabel")}
            <input value={form.name} maxLength={120} required onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("namePlaceholder")} className={field} />
          </label>
          <label className={label}>
            {t("categoryLabel")}
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={field}>
              {CATEGORIES.map((value) => <option key={value} value={value}>{t(`category_${value}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            {t("rateLabel")}
            <input type="number" min={1} step={1} required value={form.base_rate_xaf} onChange={(e) => setForm({ ...form, base_rate_xaf: e.target.value })} className={`${field} w-36`} />
          </label>
          <label className={label}>
            {t("roomCountLabel")}
            <input type="number" min={0} max={500} required value={form.room_count} onChange={(e) => setForm({ ...form, room_count: e.target.value })} className={`${field} w-24`} />
          </label>
          <label className={label}>
            {t("capacityLabel")}
            <input type="number" min={1} max={20} required value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className={`${field} w-20`} />
          </label>
          <label className={label}>
            {t("sizeLabel")}
            <input type="number" min={1} max={1000} step="0.5" value={form.size_sqm} onChange={(e) => setForm({ ...form, size_sqm: e.target.value })} className={`${field} w-24`} />
          </label>
          <label className={`${label} min-w-[12rem] grow`}>
            {t("bedSetupLabel")}
            <input value={form.bed_setup} maxLength={120} onChange={(e) => setForm({ ...form, bed_setup: e.target.value })} placeholder={t("bedSetupPlaceholder")} className={field} />
          </label>
        </div>
        <label className={label}>
          {t("amenitiesLabel")}
          <input value={form.amenities} onChange={(e) => setForm({ ...form, amenities: e.target.value })} placeholder={t("amenitiesPlaceholder")} className={field} />
        </label>
        <label className={label}>
          {t("descriptionLabel")}
          <textarea rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("descriptionPlaceholder")} className={field} />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {editingId ? t("saveChanges") : t("createButton")}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">{t("cancel")}</button>
          )}
        </div>
      </form>
    </section>
  );
}

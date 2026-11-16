"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HostelBoard, HostelOwnerRoomType, HostelPricePeriod } from "@/lib/api";
import MediaUploader from "@/components/MediaUploader";

const UNIT_TYPES = ["SHARED_ROOM", "SELF_CONTAIN", "STUDIO", "ONE_BED_APARTMENT", "MULTI_BED_APARTMENT", "POSTGRAD_UNIT", "INTERNATIONAL_UNIT"];
const PERIODS: HostelPricePeriod[] = ["MONTH", "SEMESTER", "YEAR"];
const field = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none";
const label = "flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500";

const EMPTY_FORM = {
  name: "", unit_type: "SELF_CONTAIN", occupancy_model: "PER_UNIT", beds_per_room: "1", price_xaf: "",
  price_period: "MONTH" as HostelPricePeriod, size_sqm: "", private_bathroom: false, furnished: false, description: "",
};
type Form = typeof EMPTY_FORM;

type Act = (action: string, body: Record<string, unknown>, success: string, after?: () => void) => Promise<void>;

/** The owner's side of room types: the hostel's name, then each kind of room students book (price, photos,
 * details) with its places. Rooms are put under a type when they are added. */
export default function HostelRoomTypesEditor({ board, busy, act }: { board: HostelBoard; busy: boolean; act: Act }) {
  const t = useTranslations("HostelRoomTypes");
  const tRooms = useTranslations("HostelRooms");
  const locale = useLocale();
  const [hostelName, setHostelName] = useState(board.hostel.name);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const typeLabel = (value: string) => (tRooms.has(`unitType_${value}`) ? tRooms(`unitType_${value}`) : value);
  const money = (value: string) => new Intl.NumberFormat(locale).format(Number(value));

  function startEdit(roomType: HostelOwnerRoomType) {
    setEditingId(roomType.id);
    setForm({
      name: roomType.name, unit_type: roomType.unit_type, occupancy_model: roomType.occupancy_model,
      beds_per_room: String(roomType.beds_per_room), price_xaf: String(Math.round(Number(roomType.price_xaf))),
      price_period: roomType.price_period, size_sqm: roomType.size_sqm ? String(Number(roomType.size_sqm)) : "",
      private_bathroom: roomType.private_bathroom, furnished: roomType.furnished, description: roomType.description,
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm" aria-labelledby="room-types-heading">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act("details", { name: hostelName }, t("nameSaved"));
        }}
        className="flex max-w-xl flex-wrap items-end gap-2"
      >
        <label className={`${label} grow`}>
          {t("hostelNameLabel")}
          <input value={hostelName} maxLength={120} onChange={(e) => setHostelName(e.target.value)} placeholder={t("hostelNamePlaceholder")} className={field} />
        </label>
        <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{t("save")}</button>
      </form>

      <div>
        <h3 id="room-types-heading" className="text-sm font-bold text-slate-900">{t("ownerTitle")}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t("ownerIntro")}</p>
      </div>

      {board.room_types.length === 0 ? (
        <p className="rounded-xl border border-dashed border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t("ownerEmpty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {board.room_types.map((roomType) => (
            <li key={roomType.id} className={`rounded-xl border p-4 ${roomType.is_active ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-black text-slate-900">{roomType.name}</p>
                  <p className="text-sm font-bold text-amber-700">
                    {t(`pricePer_${roomType.price_period}`, { price: money(roomType.price_xaf) })}
                    {roomType.occupancy_model === "PER_BED" && <span className="ml-1 text-xs text-slate-500">{t("perBed")}</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {typeLabel(roomType.unit_type)} · {t("beds", { count: roomType.beds_per_room })} ·{" "}
                    {t("ownerPlaces", { available: roomType.available_places, total: roomType.total_places })}
                  </p>
                  <p className="text-xs text-slate-500">{roomType.rooms.length > 0 ? t("ownerRooms", { rooms: roomType.rooms.join(", ") }) : t("ownerNoRooms")}</p>
                  {!roomType.is_active && <p className="mt-1 text-xs font-bold text-slate-600">{t("hiddenFromStudents")}</p>}
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                  <button type="button" onClick={() => startEdit(roomType)} className="text-slate-600 hover:text-slate-900">{t("edit")}</button>
                  <button
                    type="button"
                    onClick={() => act("room-type-visibility", { room_type: roomType.id, is_active: !roomType.is_active }, roomType.is_active ? t("hidden") : t("shown"))}
                    className="text-slate-600 hover:text-slate-900"
                  >
                    {roomType.is_active ? t("hide") : t("show")}
                  </button>
                  {roomType.rooms.length === 0 && (
                    <button type="button" onClick={() => act("delete-room-type", { room_type: roomType.id }, t("deleted"))} className="text-slate-400 hover:text-rose-600">
                      {t("delete")}
                    </button>
                  )}
                </div>
              </div>

              <ul className="mt-3 flex flex-wrap gap-2">
                {roomType.photos.map((photo, index) => (
                  <li key={photo.id} className="relative h-16 w-20 overflow-hidden rounded-lg border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt={t("photoAlt", { name: roomType.name, number: index + 1 })} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={t("removePhoto", { number: index + 1 })}
                      onClick={() => act("room-type-photos", { room_type: roomType.id, remove: photo.id }, t("photoRemoved"))}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-xs text-white hover:bg-slate-900"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <MediaUploader
                  folder="student-hostels"
                  accept="image/*"
                  label={t("addPhotos")}
                  onUploaded={(media) => void act("room-type-photos", { room_type: roomType.id, url: media.url }, t("photoAdded"))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            "room-types",
            {
              ...form, beds_per_room: Number(form.beds_per_room), size_sqm: form.size_sqm || null,
              ...(editingId ? { room_type: editingId } : {}),
            },
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
            {tRooms("roomType")}
            <select value={form.unit_type} onChange={(e) => setForm({ ...form, unit_type: e.target.value })} className={field}>
              {UNIT_TYPES.map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}
            </select>
          </label>
          <label className={label}>
            {tRooms("letAs")}
            <select value={form.occupancy_model} onChange={(e) => setForm({ ...form, occupancy_model: e.target.value })} className={field}>
              <option value="PER_UNIT">{tRooms("perUnit")}</option>
              <option value="PER_BED">{tRooms("perBed")}</option>
            </select>
          </label>
          <label className={label}>
            {tRooms("beds")}
            <input type="number" min={1} max={20} required value={form.beds_per_room} onChange={(e) => setForm({ ...form, beds_per_room: e.target.value })} className={`${field} w-20`} />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            {form.occupancy_model === "PER_BED" ? t("priceLabelPerBed") : t("priceLabel")}
            <input type="number" min={1} step={1} required value={form.price_xaf} onChange={(e) => setForm({ ...form, price_xaf: e.target.value })} className={`${field} w-36`} />
          </label>
          <label className={label}>
            {t("periodLabel")}
            <select value={form.price_period} onChange={(e) => setForm({ ...form, price_period: e.target.value as HostelPricePeriod })} className={field}>
              {PERIODS.map((period) => <option key={period} value={period}>{t(`period_${period}`)}</option>)}
            </select>
          </label>
          <label className={label}>
            {t("sizeLabel")}
            <input type="number" min={1} max={1000} step="0.5" value={form.size_sqm} onChange={(e) => setForm({ ...form, size_sqm: e.target.value })} className={`${field} w-24`} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.private_bathroom} onChange={(e) => setForm({ ...form, private_bathroom: e.target.checked })} />
            {t("privateBathroom")}
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.furnished} onChange={(e) => setForm({ ...form, furnished: e.target.checked })} />
            {t("furnished")}
          </label>
        </div>
        <label className={label}>
          {t("descriptionLabel")}
          <textarea rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("descriptionPlaceholder")} className={field} />
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {editingId ? t("saveChanges") : t("createButton")}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">{tRooms("cancel")}</button>
          )}
        </div>
      </form>
    </section>
  );
}

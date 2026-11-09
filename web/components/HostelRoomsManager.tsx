"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getHostelBoard,
  hostelRoomsAction,
  listManagedHostels,
  type HostelBoard,
  type HostelSummary,
} from "@/lib/api";

const UNIT_TYPES = ["SHARED_ROOM", "SELF_CONTAIN", "STUDIO", "ONE_BED_APARTMENT", "MULTI_BED_APARTMENT", "POSTGRAD_UNIT", "INTERNATIONAL_UNIT"];
const field =
  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none";
const label = "flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500";

type Pending = { kind: "end" | "move"; allocationId: string; name: string } | null;

/** Run a student hostel's rooms: set up institutions, semesters and rooms, place students, end or move them.
 * Used by hostel owners/managers on their own page and by admins in the console (`adminMode` adds search). */
export default function HostelRoomsManager({ token, adminMode = false }: { token: string; adminMode?: boolean }) {
  const t = useTranslations("HostelRooms");
  const [hostels, setHostels] = useState<HostelSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [hostelId, setHostelId] = useState<string | null>(null);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  const [board, setBoard] = useState<HostelBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [pendingValue, setPendingValue] = useState("");

  const [institutionName, setInstitutionName] = useState("");
  const [semesterForm, setSemesterForm] = useState({ institution: "", name: "", start_date: "", end_date: "", billing_due_date: "" });
  const [roomForm, setRoomForm] = useState({ room_code: "", unit_type: "SHARED_ROOM", occupancy_model: "PER_BED", bed_capacity: "2" });
  const [allocForm, setAllocForm] = useState({ student: "", unit: "" });

  const loadHostels = useCallback(async () => {
    try {
      const data = await listManagedHostels(query, token);
      setHostels(data.results || []);
      if (data.results?.length === 1) setHostelId((current) => current ?? data.results[0].id);
    } catch {
      setHostels([]);
      setMessage({ ok: false, text: t("loadError") });
    }
  }, [query, token, t]);

  const loadBoard = useCallback(async () => {
    if (!hostelId) return;
    try {
      setBoard(await getHostelBoard(hostelId, semesterId, token));
    } catch {
      setMessage({ ok: false, text: t("loadError") });
    }
  }, [hostelId, semesterId, token, t]);

  useEffect(() => {
    void Promise.resolve().then(loadHostels);
  }, [loadHostels]);
  useEffect(() => {
    void Promise.resolve().then(loadBoard);
  }, [loadBoard]);

  async function act(action: string, body: Record<string, unknown>, success: string, after?: () => void) {
    if (!hostelId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await hostelRoomsAction(hostelId, action, { ...body, semester: body.semester ?? board?.semester_id }, token);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ ok: false, text: typeof data?.detail === "string" ? data.detail : t("actionFailed") });
        return;
      }
      setBoard(data);
      setMessage({ ok: true, text: success });
      after?.();
      void loadHostels();
    } finally {
      setBusy(false);
    }
  }

  const typeLabel = (value: string) => (t.has(`unitType_${value}`) ? t(`unitType_${value}`) : value);
  const emptyPlaces = board?.rooms.flatMap((room) => room.places.filter((p) => !p.allocation).map(() => room.id)) ?? [];
  const roomsWithSpace = board?.rooms.filter((room) => room.places.some((p) => !p.allocation)) ?? [];

  if (hostels === null) return <p className="text-sm text-slate-500">{t("loading")}</p>;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t(adminMode ? "introAdmin" : "introOwner")}</p>

      {adminMode && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
          className="flex max-w-xl gap-2"
        >
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPlaceholder")} className={`${field} min-w-0 grow`} />
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">{t("search")}</button>
        </form>
      )}

      {hostels.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-600">{t(adminMode ? "noHostelsAdmin" : "noHostels")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {hostels.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                setHostelId(h.id);
                setSemesterId(null);
                setBoard(null);
                setMessage(null);
              }}
              className={`rounded-xl border px-3.5 py-2 text-left text-xs transition-colors ${hostelId === h.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="block font-bold">{h.label}</span>
              <span className="opacity-75">{t("hostelStats", { housed: h.housed_now, places: h.places, waiting: h.waiting })}</span>
            </button>
          ))}
        </div>
      )}

      {message && (
        <p role="status" className={`rounded-xl px-3.5 py-2.5 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>
      )}

      {board && (
        <>
          <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900">{t("setupTitle")}</h3>

            <div className="flex flex-wrap items-end gap-2">
              <span className="text-xs font-semibold text-slate-600">{t("institutions")}:</span>
              {board.institutions.length === 0 && <span className="text-xs text-slate-400">{t("noInstitutions")}</span>}
              {board.institutions.map((i) => (
                <span key={i.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {i.name}
                  <button
                    type="button"
                    aria-label={t("removeInstitution", { name: i.name })}
                    onClick={() => act("remove-institution", { institution: i.id }, t("institutionRemoved"))}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("institutions", { name: institutionName }, t("institutionAdded"), () => setInstitutionName(""));
              }}
              className="flex max-w-lg gap-2"
            >
              <input value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} maxLength={200} placeholder={t("institutionPlaceholder")} className={`${field} min-w-0 grow`} />
              <button type="submit" disabled={busy || !institutionName.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{t("add")}</button>
            </form>

            {board.institutions.length > 0 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("semesters", { ...semesterForm, institution: Number(semesterForm.institution) }, t("semesterAdded"), () =>
                    setSemesterForm({ institution: "", name: "", start_date: "", end_date: "", billing_due_date: "" })
                  );
                }}
                className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
              >
                <label className={label}>
                  {t("institution")}
                  <select value={semesterForm.institution} onChange={(e) => setSemesterForm({ ...semesterForm, institution: e.target.value })} className={field} required>
                    <option value="">{t("choose")}</option>
                    {board.institutions.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  {t("semesterName")}
                  <input value={semesterForm.name} maxLength={100} onChange={(e) => setSemesterForm({ ...semesterForm, name: e.target.value })} placeholder={t("semesterPlaceholder")} className={field} required />
                </label>
                {(["start_date", "end_date", "billing_due_date"] as const).map((key) => (
                  <label key={key} className={label}>
                    {t(key)}
                    <input type="date" value={semesterForm[key]} onChange={(e) => setSemesterForm({ ...semesterForm, [key]: e.target.value })} className={field} required />
                  </label>
                ))}
                <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{t("addSemester")}</button>
              </form>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("rooms", { ...roomForm, bed_capacity: Number(roomForm.bed_capacity) }, t("roomAdded"), () => setRoomForm({ ...roomForm, room_code: "" }));
              }}
              className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
            >
              <label className={label}>
                {t("roomCode")}
                <input value={roomForm.room_code} maxLength={50} onChange={(e) => setRoomForm({ ...roomForm, room_code: e.target.value })} placeholder="A-101" className={`${field} w-28`} required />
              </label>
              <label className={label}>
                {t("roomType")}
                <select value={roomForm.unit_type} onChange={(e) => setRoomForm({ ...roomForm, unit_type: e.target.value })} className={field}>
                  {UNIT_TYPES.map((value) => (
                    <option key={value} value={value}>{typeLabel(value)}</option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t("letAs")}
                <select value={roomForm.occupancy_model} onChange={(e) => setRoomForm({ ...roomForm, occupancy_model: e.target.value })} className={field}>
                  <option value="PER_BED">{t("perBed")}</option>
                  <option value="PER_UNIT">{t("perUnit")}</option>
                </select>
              </label>
              {roomForm.occupancy_model === "PER_BED" && (
                <label className={label}>
                  {t("beds")}
                  <input type="number" min={1} max={20} value={roomForm.bed_capacity} onChange={(e) => setRoomForm({ ...roomForm, bed_capacity: e.target.value })} className={`${field} w-20`} required />
                </label>
              )}
              <button type="submit" disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{t("addRoom")}</button>
            </form>
          </section>

          {board.semesters.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{t("needSemester")}</p>
          ) : (
            <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className={label}>
                  {t("semester")}
                  <select value={board.semester_id ?? ""} onChange={(e) => setSemesterId(Number(e.target.value))} className={field}>
                    {board.semesters.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.institution} ({s.start_date} → {s.end_date})
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-slate-500">{t("freePlaces", { count: emptyPlaces.length })}</p>
              </div>

              {roomsWithSpace.length > 0 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("allocate", { student: allocForm.student, unit: allocForm.unit }, t("allocated"), () => setAllocForm({ student: "", unit: "" }));
                  }}
                  className="flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3"
                >
                  <label className={label}>
                    {t("student")}
                    <input value={allocForm.student} onChange={(e) => setAllocForm({ ...allocForm, student: e.target.value })} placeholder={t("studentPlaceholder")} className={`${field} w-56`} required />
                  </label>
                  <label className={label}>
                    {t("room")}
                    <select value={allocForm.unit} onChange={(e) => setAllocForm({ ...allocForm, unit: e.target.value })} className={field} required>
                      <option value="">{t("choose")}</option>
                      {roomsWithSpace.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.room_code} · {typeLabel(room.unit_type)} ({t("freeCount", { count: room.places.filter((p) => !p.allocation).length })})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={busy} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{t("allocate")}</button>
                </form>
              )}

              {board.rooms.length === 0 ? (
                <p className="text-sm text-slate-500">{t("noRooms")}</p>
              ) : (
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {board.rooms.map((room) => (
                    <li key={room.id} className="rounded-xl border border-slate-200 p-3.5">
                      <div className="mb-2 flex items-baseline justify-between gap-2">
                        <p className="text-sm font-black text-slate-900">
                          {room.room_code} <span className="text-xs font-medium text-slate-500">· {typeLabel(room.unit_type)}</span>
                        </p>
                        {!room.has_history && (
                          <button type="button" onClick={() => act("delete-room", { unit: room.id }, t("roomDeleted"))} className="text-[11px] font-bold text-slate-400 hover:text-rose-600">
                            {t("deleteRoom")}
                          </button>
                        )}
                      </div>
                      <ul className="space-y-1.5">
                        {room.places.map((place, index) => (
                          <li key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                            <span className="text-slate-500">{place.bed !== null ? t("bed", { n: place.bed }) : t("wholeUnit")}</span>
                            {place.allocation ? (
                              <span className="flex items-center gap-2">
                                <span className="font-semibold text-slate-800">{place.allocation.student?.name}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPending({ kind: "move", allocationId: place.allocation!.id, name: place.allocation!.student?.name ?? "" });
                                    setPendingValue("");
                                  }}
                                  className="font-bold text-amber-700 hover:underline"
                                >
                                  {t("move")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPending({ kind: "end", allocationId: place.allocation!.id, name: place.allocation!.student?.name ?? "" });
                                    setPendingValue("");
                                  }}
                                  className="font-bold text-rose-700 hover:underline"
                                >
                                  {t("end")}
                                </button>
                              </span>
                            ) : (
                              <span className="font-semibold text-emerald-700">{t("free")}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}

              {pending && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (pending.kind === "end") void act("end-allocation", { allocation: pending.allocationId, reason: pendingValue }, t("ended"), () => setPending(null));
                    else void act("move-allocation", { allocation: pending.allocationId, unit: pendingValue }, t("moved"), () => setPending(null));
                  }}
                  className={`flex flex-wrap items-end gap-2 rounded-xl border p-3 ${pending.kind === "end" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}
                >
                  <p className="w-full text-sm font-bold text-slate-900">{t(pending.kind === "end" ? "endTitle" : "moveTitle", { name: pending.name })}</p>
                  {pending.kind === "end" ? (
                    <label className={`${label} grow`}>
                      {t("reason")}
                      <input value={pendingValue} maxLength={300} onChange={(e) => setPendingValue(e.target.value)} placeholder={t("reasonPlaceholder")} className={field} required />
                    </label>
                  ) : (
                    <label className={label}>
                      {t("toRoom")}
                      <select value={pendingValue} onChange={(e) => setPendingValue(e.target.value)} className={field} required>
                        <option value="">{t("choose")}</option>
                        {roomsWithSpace.map((room) => (
                          <option key={room.id} value={room.id}>{room.room_code} · {typeLabel(room.unit_type)}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="submit" disabled={busy || !pendingValue.trim()} className={`rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${pending.kind === "end" ? "bg-rose-600" : "bg-amber-600"}`}>
                    {t(pending.kind === "end" ? "confirmEnd" : "confirmMove")}
                  </button>
                  <button type="button" onClick={() => setPending(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700">{t("cancel")}</button>
                </form>
              )}

              <div className="border-t border-slate-100 pt-4">
                <h4 className="mb-2 text-sm font-bold text-slate-900">{t("waitlistTitle")}</h4>
                {board.waitlist.length === 0 ? (
                  <p className="text-xs text-slate-500">{t("waitlistEmpty")}</p>
                ) : (
                  <ol className="space-y-1.5 text-xs">
                    {board.waitlist.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap items-center gap-2">
                        <span className="w-6 text-right font-black text-slate-400">{entry.position}.</span>
                        <span className="font-semibold text-slate-800">{entry.student?.name}</span>
                        <span className="text-slate-500">@{entry.student?.username} · {typeLabel(entry.desired_unit_type)}</span>
                        {entry.already_housed && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{t("alreadyHoused")}</span>}
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-2 text-[11px] text-slate-400">{t("waitlistHint")}</p>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

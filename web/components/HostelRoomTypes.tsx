"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HostelPricePeriod, HostelRoomType } from "@/lib/api";
import BookingCheckoutModal from "@/components/BookingCheckoutModal";
import ShareButton from "@/components/ShareButton";

interface Props {
  /** The hostel page's locale-less path, e.g. "/student-hostels/<id>"; a room's share link adds ?room=<id>. */
  sharePath: string;
  hostelTitle: string;
  quarterName: string;
  roomTypes: HostelRoomType[];
}

/** A hostel's room types as cards (photo, price, places left); a card opens its photos and details, from where
 * the student reserves a place at that room type's own price. */
export default function HostelRoomTypes({ sharePath, hostelTitle, quarterName, roomTypes }: Props) {
  const t = useTranslations("HostelRoomTypes");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reserving, setReserving] = useState<HostelRoomType | null>(null);
  const open = roomTypes.find((r) => r.id === openId) ?? null;

  // A shared room link (?room=<id>) opens that room's pop-up.
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get("room");
    if (shared && roomTypes.some((r) => r.id === shared)) void Promise.resolve().then(() => setOpenId(shared));
  }, [roomTypes]);

  if (roomTypes.length === 0) return null;

  return (
    <section className="mb-6" aria-labelledby="hostel-room-types">
      <h2 id="hostel-room-types" className="text-sm font-semibold text-gray-700 mb-3">{t("title")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {roomTypes.map((roomType) => (
          <button
            key={roomType.id}
            type="button"
            onClick={() => setOpenId(roomType.id)}
            className="group text-left rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <div className="relative h-40 bg-slate-100">
              {roomType.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={roomType.photos[0].url} alt={roomType.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-400">{t("noPhoto")}</div>
              )}
              {roomType.photos.length > 1 && (
                <span className="absolute bottom-2 right-2 rounded-md bg-slate-900/75 px-2 py-0.5 text-[11px] font-bold text-white">
                  {t("photoCount", { count: roomType.photos.length })}
                </span>
              )}
              <Availability roomType={roomType} className="absolute top-2 left-2" />
            </div>
            <div className="p-4">
              <p className="font-bold text-[var(--navy)] group-hover:text-amber-700">{roomType.name}</p>
              <Price roomType={roomType} className="mt-1 text-lg" />
              <Features roomType={roomType} className="mt-2" />
              <p className="mt-3 text-xs font-bold text-amber-700">{t("viewRoom")} →</p>
            </div>
          </button>
        ))}
      </div>

      {open && <RoomTypeDialog roomType={open} sharing={{ title: `${open.name} · ${hostelTitle}`, location: quarterName, path: `${sharePath}?room=${open.id}` }} onClose={() => setOpenId(null)} onReserve={() => { setReserving(open); setOpenId(null); }} />}

      {reserving && (
        <BookingCheckoutModal
          isOpen
          onClose={() => setReserving(null)}
          bookingType="HOSTEL_SEMESTER"
          title={`${reserving.name} · ${hostelTitle}`}
          quarterName={quarterName}
          priceXaf={reserving.price_xaf}
          targetId={reserving.id}
          targetContentType="student_hostels.HostelRoomType"
          maxPeriods={reserving.max_periods}
          periodLabel={(count) => t(`periodCount_${reserving.price_period}`, { count })}
        />
      )}
    </section>
  );
}

function usePriceText() {
  const t = useTranslations("HostelRoomTypes");
  const locale = useLocale();
  return (priceXaf: string, period: HostelPricePeriod) =>
    t(`pricePer_${period}`, { price: new Intl.NumberFormat(locale).format(Number(priceXaf)) });
}

function Price({ roomType, className = "" }: { roomType: HostelRoomType; className?: string }) {
  const t = useTranslations("HostelRoomTypes");
  const priceText = usePriceText();
  return (
    <p className={`font-black text-slate-900 ${className}`}>
      {priceText(roomType.price_xaf, roomType.price_period)}
      {roomType.occupancy_model === "PER_BED" && <span className="ml-1 text-xs font-semibold text-slate-500">{t("perBed")}</span>}
    </p>
  );
}

function Availability({ roomType, className = "" }: { roomType: HostelRoomType; className?: string }) {
  const t = useTranslations("HostelRoomTypes");
  const full = roomType.available_places < 1;
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${full ? "bg-slate-700 text-white" : "bg-emerald-600 text-white"} ${className}`}>
      {full ? t("fullyBooked") : t("placesLeft", { count: roomType.available_places })}
    </span>
  );
}

function Features({ roomType, className = "" }: { roomType: HostelRoomType; className?: string }) {
  const t = useTranslations("HostelRoomTypes");
  const tRooms = useTranslations("HostelRooms");
  const items = [
    tRooms(`unitType_${roomType.unit_type}`),
    t("beds", { count: roomType.beds_per_room }),
    roomType.size_sqm ? t("size", { size: Number(roomType.size_sqm) }) : null,
    roomType.private_bathroom ? t("privateBathroom") : t("sharedBathroom"),
    roomType.furnished ? t("furnished") : null,
  ].filter(Boolean) as string[];
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {items.map((item) => (
        <li key={item} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{item}</li>
      ))}
    </ul>
  );
}

function RoomTypeDialog({
  roomType, sharing, onClose, onReserve,
}: { roomType: HostelRoomType; sharing: { title: string; location: string; path: string }; onClose: () => void; onReserve: () => void }) {
  const t = useTranslations("HostelRoomTypes");
  const [photoIndex, setPhotoIndex] = useState(0);
  const photo = roomType.photos[photoIndex];
  const full = roomType.available_places < 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-type-dialog-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-slate-100">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt={t("photoAlt", { name: roomType.name, number: photoIndex + 1 })} className="h-72 w-full object-cover" />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm font-semibold text-slate-400">{t("noPhoto")}</div>
          )}
          <ShareButton variant="dialog" title={sharing.title} location={sharing.location} path={sharing.path} />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/70 text-xl text-white hover:bg-slate-900"
          >
            ×
          </button>
        </div>
        {roomType.photos.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-5 pt-3">
            {roomType.photos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPhotoIndex(i)}
                aria-label={t("showPhoto", { number: i + 1 })}
                aria-pressed={i === photoIndex}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${i === photoIndex ? "border-amber-500" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="room-type-dialog-title" className="text-xl font-black text-[var(--navy)]">{roomType.name}</h3>
              <Price roomType={roomType} className="mt-1 text-xl" />
            </div>
            <Availability roomType={roomType} />
          </div>
          <Features roomType={roomType} className="mt-3" />
          {roomType.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{roomType.description}</p>}
          <p className="mt-4 text-xs text-slate-500">{t("escrowNote")}</p>
          <button
            type="button"
            onClick={onReserve}
            disabled={full}
            className="mt-4 w-full rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950 shadow-md shadow-amber-500/20 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {full ? t("fullyBooked") : t("reserve")}
          </button>
        </div>
      </div>
    </div>
  );
}

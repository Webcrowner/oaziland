"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getStayAvailability, type HotelStayOption, type RoomTypePlaceEndpoint, type RoomTypeSummary } from "@/lib/api";
import BookingCheckoutModal from "@/components/BookingCheckoutModal";
import ShareButton from "@/components/ShareButton";

function localIsoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

type Quote = { checkIn: string; checkOut: string; options: Record<string, HotelStayOption> };

type Place = { id: string; quarter_name: string; room_types: RoomTypeSummary[] };

/** A hotel's, apartment building's or guest house's room types as cards — its own little catalogue. The guest
 * picks dates and party size once; every card then shows the rooms still free and the exact price for that stay,
 * as the server will charge it. A card opens its photos and details, from where the guest books that room type. */
export default function HotelRoomBooking({
  hotel, title, endpoint = "hotels",
}: { hotel: Place; title: string; endpoint?: RoomTypePlaceEndpoint }) {
  const t = useTranslations("HotelRoomBooking");
  const locale = useLocale();
  const format = (value: number | string) => new Intl.NumberFormat(locale).format(Number(value));
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [checking, setChecking] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [booking, setBooking] = useState<RoomTypeSummary | null>(null);
  const checkInRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const roomTypes = hotel.room_types;
  const open = roomTypes.find((r) => r.id === openId) ?? null;
  const roomPath = (roomTypeId: string) => `/${endpoint}/${hotel.id}?room=${roomTypeId}`;

  // A shared room link (?room=<id>) opens that room's pop-up.
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get("room");
    if (shared && hotel.room_types.some((r) => r.id === shared)) void Promise.resolve().then(() => setOpenId(shared));
  }, [hotel.room_types]);
  const quoteFresh = quote && quote.checkIn === checkIn && quote.checkOut === checkOut ? quote : null;

  async function refreshQuote(nextIn: string, nextOut: string) {
    setQuoteError("");
    if (!nextIn || !nextOut || nextOut <= nextIn) {
      setQuote(null);
      return;
    }
    const id = ++requestId.current;
    setChecking(true);
    try {
      const data = await getStayAvailability(endpoint, hotel.id, nextIn, nextOut);
      if (id !== requestId.current) return;
      setQuote({ checkIn: nextIn, checkOut: nextOut, options: Object.fromEntries(data.room_types.map((o) => [o.room_type, o])) });
    } catch (err) {
      if (id !== requestId.current) return;
      setQuote(null);
      setQuoteError(err instanceof Error ? err.message : t("quoteFailed"));
    } finally {
      if (id === requestId.current) setChecking(false);
    }
  }

  function chooseCheckIn(value: string) {
    setCheckIn(value);
    let nextOut = checkOut;
    if (value && (!checkOut || checkOut <= value)) {
      const d = new Date(`${value}T12:00:00`);
      d.setDate(d.getDate() + 1);
      nextOut = d.toISOString().slice(0, 10);
      setCheckOut(nextOut);
    }
    void refreshQuote(value, nextOut);
  }

  function chooseCheckOut(value: string) {
    setCheckOut(value);
    void refreshQuote(checkIn, value);
  }

  function startBooking(roomType: RoomTypeSummary) {
    setOpenId(null);
    if (!quoteFresh) {
      checkInRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      checkInRef.current?.focus();
      setQuoteError(t("chooseDatesFirst"));
      return;
    }
    setBooking(roomType);
  }

  if (roomTypes.length === 0) return null;

  const bookingOption = booking && quoteFresh ? quoteFresh.options[booking.id] : null;

  return (
    <section className="mb-6" aria-labelledby="hotel-rooms-heading">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <h2 id="hotel-rooms-heading" className="text-base font-bold text-[var(--navy)]">{t("title")}</h2>
        <p className="text-xs text-slate-500">{t("typeCount", { count: roomTypes.length })}</p>
      </div>

      <div className="mb-4 grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
          {t("checkIn")}
          <input
            ref={checkInRef}
            type="date"
            min={localIsoDate()}
            value={checkIn}
            onChange={(e) => chooseCheckIn(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
          {t("checkOut")}
          <input
            type="date"
            min={checkIn || localIsoDate(1)}
            value={checkOut}
            onChange={(e) => chooseCheckOut(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          />
        </label>
        <label className="col-span-2 sm:col-span-1 text-[11px] font-bold uppercase tracking-wider text-slate-600">
          {t("guests")}
          <select
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-slate-800"
          >
            {Array.from({ length: Math.max(...roomTypes.map((r) => r.capacity), 1) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{t("guestCount", { count: n })}</option>
            ))}
          </select>
        </label>
        <p className="col-span-2 sm:col-span-3 text-xs text-slate-500" aria-live="polite">
          {checking ? t("checking") : quoteError || (quoteFresh ? t("pricesForStay") : t("pickDates"))}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {roomTypes.map((roomType) => {
          const option = quoteFresh?.options[roomType.id];
          return (
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
                <Availability roomType={roomType} option={option} guests={guests} className="absolute top-2 left-2" />
              </div>
              <div className="p-4">
                <p className="font-bold text-[var(--navy)] group-hover:text-amber-700">{roomType.name}</p>
                <p className="mt-1 text-lg font-black text-slate-900">{t("perNight", { price: format(roomType.base_rate_xaf) })}</p>
                {option && option.rooms_free > 0 && (
                  <p className="text-xs font-semibold text-emerald-700">{t("stayTotal", { count: option.nights, price: format(option.total_xaf) })}</p>
                )}
                <Features roomType={roomType} className="mt-2" />
                <p className="mt-3 text-xs font-bold text-amber-700">{t("viewRoom")} →</p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-gray-500">{t("escrowNote")}</p>

      {open && (
        <RoomTypeDialog
          roomType={open}
          sharing={{ title: `${open.name} · ${title}`, location: hotel.quarter_name, path: roomPath(open.id) }}
          option={quoteFresh?.options[open.id]}
          guests={guests}
          onClose={() => setOpenId(null)}
          onBook={() => startBooking(open)}
        />
      )}

      {booking && bookingOption && quoteFresh && (
        <BookingCheckoutModal
          isOpen
          onClose={() => setBooking(null)}
          bookingType="HOTEL"
          title={`${booking.name} · ${title}`}
          quarterName={hotel.quarter_name}
          priceXaf={booking.base_rate_xaf}
          targetId={hotel.id}
          targetContentType="hotels.Reservation"
          roomTypeId={booking.id}
          stay={{
            checkIn: quoteFresh.checkIn,
            checkOut: quoteFresh.checkOut,
            adults: guests,
            children: 0,
            totalXaf: Number(bookingOption.total_xaf),
            summary: t("staySummary", {
              checkIn: new Date(`${quoteFresh.checkIn}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" }),
              checkOut: new Date(`${quoteFresh.checkOut}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }),
              nights: bookingOption.nights,
              guests,
            }),
          }}
        />
      )}
    </section>
  );
}

function bookability(roomType: RoomTypeSummary, option: HotelStayOption | undefined, guests: number) {
  if (roomType.room_count < 1) return "unavailable" as const;
  if (guests > roomType.capacity) return "tooSmall" as const;
  if (option && option.rooms_free < 1) return "soldOut" as const;
  return "ok" as const;
}

function Availability({ roomType, option, guests, className = "" }: { roomType: RoomTypeSummary; option?: HotelStayOption; guests: number; className?: string }) {
  const t = useTranslations("HotelRoomBooking");
  const state = bookability(roomType, option, guests);
  const text =
    state === "unavailable" ? t("unavailable")
    : state === "tooSmall" ? t("sleepsOnly", { count: roomType.capacity })
    : state === "soldOut" ? t("soldOut")
    : option ? t("roomsLeft", { count: option.rooms_free })
    : t("roomCount", { count: roomType.room_count });
  const tone = state === "ok" ? (option ? "bg-emerald-600" : "bg-slate-900/75") : "bg-slate-700";
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold text-white ${tone} ${className}`}>{text}</span>;
}

function Features({ roomType, className = "" }: { roomType: RoomTypeSummary; className?: string }) {
  const t = useTranslations("HotelRoomBooking");
  const items = [
    t("sleeps", { count: roomType.capacity }),
    roomType.bed_setup || null,
    roomType.size_sqm ? t("size", { size: Number(roomType.size_sqm) }) : null,
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
  roomType, sharing, option, guests, onClose, onBook,
}: {
  roomType: RoomTypeSummary; sharing: { title: string; location: string; path: string };
  option?: HotelStayOption; guests: number; onClose: () => void; onBook: () => void;
}) {
  const t = useTranslations("HotelRoomBooking");
  const locale = useLocale();
  const [photoIndex, setPhotoIndex] = useState(0);
  const photo = roomType.photos[photoIndex];
  const state = bookability(roomType, option, guests);
  const format = (value: number | string) => new Intl.NumberFormat(locale).format(Number(value));

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
        aria-labelledby="hotel-room-dialog-title"
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
          <ShareButton variant="dialog" title={sharing.title} location={sharing.location} price={new Intl.NumberFormat(locale).format(Number(roomType.base_rate_xaf))} path={sharing.path} />
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
              <h3 id="hotel-room-dialog-title" className="text-xl font-black text-[var(--navy)]">{roomType.name}</h3>
              <p className="mt-1 text-xl font-black text-slate-900">{t("perNight", { price: format(roomType.base_rate_xaf) })}</p>
              {option && option.rooms_free > 0 && (
                <p className="text-sm font-semibold text-emerald-700">{t("stayTotal", { count: option.nights, price: format(option.total_xaf) })}</p>
              )}
            </div>
            <Availability roomType={roomType} option={option} guests={guests} />
          </div>
          <Features roomType={roomType} className="mt-3" />
          {roomType.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{roomType.description}</p>}
          {(roomType.amenities ?? []).length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-1 text-sm text-slate-700">
              {(roomType.amenities ?? []).map((a) => <li key={a}>✓ {a.replace(/_/g, " ")}</li>)}
            </ul>
          )}
          <p className="mt-4 text-xs text-slate-500">{t("escrowNote")}</p>
          <button
            type="button"
            onClick={onBook}
            disabled={state !== "ok"}
            className="mt-4 w-full rounded-xl bg-amber-500 py-3 text-sm font-black text-slate-950 shadow-md shadow-amber-500/20 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state === "soldOut" ? t("soldOut") : state === "tooSmall" ? t("sleepsOnly", { count: roomType.capacity }) : state === "unavailable" ? t("unavailable") : option ? t("bookThis") : t("chooseDatesToBook")}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  getMyProfile, getMyKycStatus, getCarAvailability, getCarQuote, placeMarketplaceOrder, blockCarDates, unblockCarDates,
  type CarBusyPeriod, type CarRentalQuote,
} from "@/lib/api";

export interface RentalCarTerms {
  id: string;
  ownerId: string;
  availability: string;
  driverOption: string;
  deliveryAvailable: boolean;
  minDriverAge: number | null;
  minLicenceYears: number | null;
  /** false: the owner accepts or declines each booking request. */
  instantBook: boolean;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (value: string, days: number) => {
  const [y, m, d] = value.split("-").map(Number);
  return iso(new Date(y, m - 1, d + days));
};
const isBusy = (day: string, busy: CarBusyPeriod[]) => busy.some((p) => p.start <= day && day < p.end);
const rangeFree = (start: string, end: string, busy: CarBusyPeriod[]) => !busy.some((p) => p.start < end && start < p.end);
const fmt = (value: string) => Number(value).toLocaleString();

/** A month grid: taken days are struck through; renters tap a start day then a return day. */
function MonthCalendar({
  busy, start, end, onPick, locale,
}: { busy: CarBusyPeriod[]; start: string; end: string; onPick: (day: string) => void; locale: string }) {
  const t = useTranslations("CarRental");
  const today = iso(new Date());
  const [offset, setOffset] = useState(0);
  const first = new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "narrow" }));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), i + 1)))];

  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <div className="mb-1 flex items-center justify-between text-sm font-semibold text-[var(--navy)]">
        <button type="button" onClick={() => setOffset(offset - 1)} disabled={offset === 0} aria-label={t("prevMonth")} className="px-2 disabled:opacity-30">‹</button>
        <span>{first.toLocaleDateString(locale, { month: "long", year: "numeric" })}</span>
        <button type="button" onClick={() => setOffset(offset + 1)} disabled={offset >= 11} aria-label={t("nextMonth")} className="px-2 disabled:opacity-30">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {weekdays.map((w, i) => <span key={i} className="py-1 font-semibold text-slate-400">{w}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={`x${i}`} />;
          const past = day < today;
          const taken = isBusy(day, busy);
          const selected = start && (day === start || (end && day >= start && day < end));
          const isReturn = end && day === end;
          return (
            <button
              key={day} type="button" disabled={past} onClick={() => onPick(day)}
              aria-label={`${day}${taken ? ` (${t("taken")})` : ""}`}
              className={`rounded py-1.5 ${past ? "text-slate-300" : taken ? "bg-slate-100 text-slate-400 line-through" : selected ? "bg-[var(--navy)] text-white" : isReturn ? "bg-[var(--gold)] text-[var(--navy)]" : "hover:bg-slate-100"}`}
            >
              {Number(day.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--navy)]" />{t("legendSelected")}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-300" />{t("legendTaken")}</span>
      </p>
    </div>
  );
}

/** Owner side: see bookings and keep days off the calendar (servicing, personal use). */
function OwnerCalendar({ car }: { car: RentalCarTerms }) {
  const t = useTranslations("CarRental");
  const locale = useLocale();
  const [busy, setBusy] = useState<CarBusyPeriod[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = () => getCarAvailability(car.id, localStorage.getItem("access_token")).then((r) => setBusy(r.busy)).catch(() => setError(t("calendarFailed")));
  useEffect(() => {
    getCarAvailability(car.id, localStorage.getItem("access_token")).then((r) => setBusy(r.busy)).catch(() => setError(t("calendarFailed")));
  }, [car.id, t]);

  function pick(day: string) {
    if (!from || (from && to) || day <= from) {
      setFrom(day);
      setTo("");
    } else {
      setTo(addDays(day, 1));
    }
  }

  async function block(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !from) return;
    setSaving(true);
    setError("");
    try {
      await blockCarDates(car.id, { starts_on: from, ends_on: to || addDays(from, 1), note: note.trim() }, token);
      setFrom(""); setTo(""); setNote("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("blockFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function unblock(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await unblockCarDates(car.id, id, token).then(reload).catch(() => setError(t("blockFailed")));
  }

  const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div>
        <p className="font-bold text-[var(--navy)]">{t("ownerCalendarTitle")}</p>
        <p className="text-xs text-slate-500">{t("ownerCalendarHint")}</p>
      </div>
      <MonthCalendar busy={busy} start={from} end={to} onPick={pick} locale={locale} />
      <form onSubmit={block} className="flex flex-col gap-2">
        <p className="text-xs text-slate-600">{from ? t("blockRange", { from: day(from), to: day(addDays(to || addDays(from, 1), -1)) }) : t("blockPick")}</p>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder={t("blockNote")} className="rounded-lg border px-3 py-2" />
        <button type="submit" disabled={!from || saving} className="rounded-lg bg-[var(--navy)] px-3 py-2 font-semibold text-white disabled:opacity-50">{t("blockDays")}</button>
      </form>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {busy.length > 0 && (
        <ul className="flex flex-col gap-1">
          {busy.map((p, i) => (
            <li key={p.id ?? `${p.start}-${i}`} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
              <span>
                <span className={`mr-2 rounded px-1.5 text-[11px] font-semibold ${p.kind === "booked" ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-700"}`}>
                  {p.kind === "booked" ? t("kindBooked") : t("kindBlocked")}
                </span>
                {day(p.start)} → {day(p.kind === "blocked" ? addDays(p.end, -1) : p.end)}{p.note ? ` · ${p.note}` : ""}
              </span>
              {p.kind === "blocked" && p.id && (
                <button type="button" onClick={() => unblock(p.id as string)} className="text-xs font-semibold text-red-700 underline">{t("unblock")}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link href={`/marketplace/sell/cars?edit=${car.id}`} className="font-semibold text-[var(--navy)] underline">{t("editCar")}</Link>
    </div>
  );
}

/** Book a car for chosen days, like Turo: pick dates on the calendar, see the full price, pay into escrow. */
export default function CarRentalBox({ car }: { car: RentalCarTerms }) {
  const t = useTranslations("CarRental");
  const tb = useTranslations("MarketplaceBuyBox");
  const locale = useLocale();
  const router = useRouter();
  const [role, setRole] = useState<"loading" | "signedOut" | "owner" | "needsKyc" | "renter">("loading");
  const [busy, setBusy] = useState<CarBusyPeriod[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [withDriver, setWithDriver] = useState(car.driverOption === "WITH_DRIVER");
  const [delivery, setDelivery] = useState(false);
  const [quote, setQuote] = useState<CarRentalQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [meetsRequirements, setMeetsRequirements] = useState(false);
  const [phone, setPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState(false);
  const today = useMemo(() => iso(new Date()), []);
  const selfDrive = !withDriver;
  const hasRequirements = selfDrive && Boolean(car.minDriverAge || car.minLicenceYears);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const lookup = token
      ? getMyProfile(token).then(async (profile) => {
        if (profile.id === car.ownerId) return "owner" as const;
        const kyc = await getMyKycStatus(token).catch(() => "unknown" as const);
        return kyc === null ? ("needsKyc" as const) : ("renter" as const);
      }).catch(() => "signedOut" as const)
      : Promise.resolve("signedOut" as const);
    lookup.then(setRole);
    getCarAvailability(car.id).then((r) => setBusy(r.busy)).catch(() => {});
  }, [car.id, car.ownerId]);

  useEffect(() => {
    if (!start || !end) return;
    let cancelled = false;
    getCarQuote(car.id, { start, end, withDriver, delivery })
      .then((q) => { if (!cancelled) { setQuote(q); setQuoteError(""); } })
      .catch((err) => { if (!cancelled) { setQuote(null); setQuoteError(err instanceof Error ? err.message : t("quoteFailed")); } });
    return () => { cancelled = true; };
  }, [car.id, start, end, withDriver, delivery, t]);

  function pick(day: string) {
    setError("");
    if (!start || end || day <= start) {
      setStart(day);
      setEnd("");
      setQuote(null);
      setQuoteError("");
      return;
    }
    if (!rangeFree(start, day, busy)) {
      setQuoteError(t("rangeTaken"));
      return;
    }
    setEnd(day);
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !quote) return;
    setPaying(true);
    setError("");
    try {
      await placeMarketplaceOrder("cars", car.id, phone.trim(), token, { start_date: start, end_date: end, with_driver: withDriver, delivery });
      setPlaced(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : tb("failed"));
      getCarAvailability(car.id).then((r) => setBusy(r.busy)).catch(() => {});
    } finally {
      setPaying(false);
    }
  }

  if (role === "loading") return null;
  if (role === "owner") return <OwnerCalendar car={car} />;
  if (placed) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        <p className="mb-1 font-semibold">{car.instantBook ? t("bookedTitle") : t("requestSentTitle")}</p>
        <p className="mb-2">{car.instantBook ? t("bookedBody") : t("requestSentBody")}</p>
        <Link href="/marketplace/orders" className="font-semibold text-[var(--navy)] underline">{tb("viewOrders")}</Link>
      </div>
    );
  }
  if (car.availability !== "AVAILABLE") {
    return <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">{t("notRenting")}</div>;
  }

  const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--gold)] bg-white p-4 text-sm">
      <h2 className="font-bold text-[var(--navy)]">{t("bookTitle")}</h2>
      <p className={`-mt-2 text-xs font-semibold ${car.instantBook ? "text-green-700" : "text-slate-600"}`}>
        {car.instantBook ? `⚡ ${t("instantBadge")}` : t("requestNote")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          {t("pickUp")}
          <input type="date" min={today} value={start} onChange={(e) => { setStart(e.target.value); setEnd(""); setQuote(null); }} className="rounded-lg border px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          {t("return")}
          <input type="date" min={start ? addDays(start, 1) : today} value={end} disabled={!start} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" />
        </label>
      </div>
      <MonthCalendar busy={busy} start={start} end={end} onPick={pick} locale={locale} />
      {!start && <p className="text-xs text-slate-500">{t("pickHint")}</p>}

      {car.driverOption === "EITHER" && (
        <label className="flex items-center gap-2"><input type="checkbox" checked={withDriver} onChange={(e) => setWithDriver(e.target.checked)} /> {t("addDriver")}</label>
      )}
      {car.driverOption === "WITH_DRIVER" && <p className="text-xs text-slate-600">{t("driverIncludedNote")}</p>}
      {car.deliveryAvailable && (
        <label className="flex items-center gap-2"><input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} /> {t("addDelivery")}</label>
      )}

      {quoteError && <p role="alert" className="text-amber-800">{quoteError}</p>}
      {quote && (
        <dl className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
          <p className="mb-1 text-xs text-slate-600">{t("tripDates", { start: day(quote.start_date), end: day(quote.end_date) })}</p>
          <div className="flex justify-between"><dt>{t("lineBase", { rate: fmt(quote.daily_rate_xaf), days: quote.days })}</dt><dd>{fmt(quote.base_xaf)} XAF</dd></div>
          {Number(quote.discount_xaf) > 0 && <div className="flex justify-between text-green-700"><dt>{t("lineDiscount", { pct: quote.discount_pct })}</dt><dd>−{fmt(quote.discount_xaf)} XAF</dd></div>}
          {Number(quote.driver_fee_xaf) > 0 && <div className="flex justify-between"><dt>{t("lineDriver")}</dt><dd>{fmt(quote.driver_fee_xaf)} XAF</dd></div>}
          {Number(quote.delivery_fee_xaf) > 0 && <div className="flex justify-between"><dt>{t("lineDelivery")}</dt><dd>{fmt(quote.delivery_fee_xaf)} XAF</dd></div>}
          {Number(quote.deposit_xaf) > 0 && <div className="flex justify-between text-slate-600"><dt>{t("lineDeposit")}</dt><dd>{fmt(quote.deposit_xaf)} XAF</dd></div>}
          <div className="mt-1 flex justify-between border-t pt-1 font-bold text-[var(--navy)]"><dt>{t("lineTotal")}</dt><dd>{fmt(quote.total_xaf)} XAF</dd></div>
          <p className="mt-1 text-xs text-slate-500">{t("cancellationPolicy")}</p>
        </dl>
      )}

      {role === "signedOut" ? (
        <Link href="/login" className="inline-block rounded-lg bg-[var(--navy)] px-4 py-2 text-center font-semibold text-white">{tb("signIn")}</Link>
      ) : role === "needsKyc" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <p className="mb-1">{tb("kycNeeded")}</p>
          <Link href="/kyc" className="font-bold underline">{tb("kycLink")}</Link>
        </div>
      ) : (
        <form onSubmit={pay} className="flex flex-col gap-2">
          {hasRequirements && (
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" required checked={meetsRequirements} onChange={(e) => setMeetsRequirements(e.target.checked)} className="mt-0.5" />
              {t("requirementsConfirm", { age: car.minDriverAge ?? 18, years: car.minLicenceYears ?? 0 })}
            </label>
          )}
          <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tb("phonePlaceholder")} aria-label={tb("phonePlaceholder")} className="rounded-lg border px-3 py-2" />
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <button
            type="submit" disabled={paying || !quote || !phone.trim() || (hasRequirements && !meetsRequirements)}
            className="cursor-pointer rounded-lg bg-[var(--navy)] px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {paying ? tb("paying") : quote ? t(car.instantBook ? "payButton" : "requestButton", { amount: fmt(quote.total_xaf) }) : t("chooseDates")}
          </button>
          <p className="text-xs text-slate-500">{tb("escrowExplainer")}</p>
        </form>
      )}
    </div>
  );
}

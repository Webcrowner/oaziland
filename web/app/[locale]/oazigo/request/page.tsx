"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { quoteRide, requestRide, RideRequestError, type LuggageSize, type RideQuote } from "@/lib/api";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import { IconAlertCircle, IconCar, IconCheckCircle, IconCompass, IconMapPin } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import RideLocationField from "@/components/oazigo/RideLocationField";
import RouteMap from "@/components/oazigo/RouteMap";
import RouteStops from "@/components/oazigo/RouteStops";
import { RIDE_CATEGORIES, ACTIVE_RIDE_STATUSES, cardCls, inputCls, labelCls } from "@/components/oazigo/styles";
import { formatDuration } from "@/components/oazigo/route";

const NO_GPS = { latitude: null, longitude: null };
const LUGGAGE_SIZES: LuggageSize[] = ["SMALL", "MEDIUM", "LARGE", "BULKY"];
const MAX_LUGGAGE_PHOTOS = 3;
const QUOTE_DELAY_MS = 400;

type Gps = { latitude: number | null; longitude: number | null };

export default function OaziGoRequestPage() {
  const t = useTranslations("OaziGoPage");
  const locale = useLocale();
  const router = useRouter();
  const { reload, myRides, myUserId } = useOaziGo();
  // The server allows one open trip per rider; saying so here beats failing after the form is filled in.
  const activeTrip = myRides.some((r) => r.rider === myUserId && ACTIVE_RIDE_STATUSES.includes(r.status));

  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [pickupGps, setPickupGps] = useState<Gps>(NO_GPS);
  const [dropoffGps, setDropoffGps] = useState<Gps>(NO_GPS);
  const [rideCategory, setRideCategory] = useState<string>("STANDARD");
  const [transportType, setTransportType] = useState<"PASSENGER" | "CARGO">("PASSENGER");
  const [hasLuggage, setHasLuggage] = useState(false);
  const [luggageCount, setLuggageCount] = useState("");
  const [luggageSize, setLuggageSize] = useState<LuggageSize | "">("");
  const [luggagePhotos, setLuggagePhotos] = useState<string[]>([]);
  const [cargoDescription, setCargoDescription] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");

  const [quoteResult, setQuoteResult] = useState<{ key: string; quote: RideQuote | null } | null>(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);

  const points = pickupGps.latitude !== null && pickupGps.longitude !== null && dropoffGps.latitude !== null && dropoffGps.longitude !== null
    ? { pickup_latitude: pickupGps.latitude, pickup_longitude: pickupGps.longitude, dropoff_latitude: dropoffGps.latitude, dropoff_longitude: dropoffGps.longitude }
    : null;
  const requestKey = points ? `${Object.values(points).join(",")}#${quoteAttempt}` : "";
  // A result only counts for the points (and retry) it was fetched for.
  const current = quoteResult && quoteResult.key === requestKey ? quoteResult : null;
  const quote = current?.quote ?? null;
  const quoteFailed = Boolean(current && !current.quote);
  const quoting = Boolean(points) && !current;

  // The price comes from the server's road route between the two points, never from the browser.
  useEffect(() => {
    if (!points) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      quoteRide(points, token, controller.signal)
        .then((result) => setQuoteResult({ key: requestKey, quote: result }))
        .catch(() => { if (!controller.signal.aborted) setQuoteResult({ key: requestKey, quote: null }); });
    }, QUOTE_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // requestKey stands for the four coordinates and the retry count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const retryQuote = useCallback(() => setQuoteAttempt((n) => n + 1), []);
  const fareFor = (category: string) => (quote ? Number(quote.fares[category]) : null);
  const selectedFare = fareFor(rideCategory);
  const duration = quote ? formatDuration(quote.duration_minutes, { min: t("durationMin"), h: t("durationHour") }) : "";
  const km = quote ? Number(quote.distance_km).toLocaleString(locale, { maximumFractionDigits: 1 }) : "";
  // Route chosen → ride and price chosen → ready to confirm.
  const step = !points ? 0 : !quote ? 1 : 2;
  const requestLabel = requesting
    ? t("requesting")
    : selectedFare !== null ? t("requestRideWithFare", { fare: selectedFare.toLocaleString(locale) }) : t("requestRide");

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !points || !quote) return;
    setRequesting(true);
    setRequestError("");
    try {
      await requestRide({
        pickup_description: pickup,
        dropoff_description: dropoff,
        ...points,
        ride_category: rideCategory,
        transport_type: transportType,
        has_luggage: hasLuggage,
        ...(hasLuggage && transportType === "PASSENGER"
          ? { luggage_count: luggageCount ? Number(luggageCount) : null, luggage_size: luggageSize, luggage_photo_urls: luggagePhotos }
          : {}),
        cargo_description: transportType === "CARGO" ? cargoDescription : undefined,
      }, token);
      reload();
      router.push("/oazigo/trips");
    } catch (err) {
      const code = err instanceof RideRequestError ? err.code : undefined;
      setRequestError(
        code === "ACTIVE_RIDE_EXISTS" ? t("activeRideBlock")
          : code === "UNPAID_FARE" ? t("unpaidFareBlocked")
            : err instanceof Error ? err.message : t("requestFailed"),
      );
      if (code === "ACTIVE_RIDE_EXISTS") reload();
      setRequesting(false);
    }
  }

  return (
    <form onSubmit={handleRequest} className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-lg shadow-slate-900/10 sm:px-8 sm:py-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20">
              <IconMapPin size={22} />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("requestRideTitle")}</h1>
              <p className="mt-1 text-sm text-slate-300">{t("requestCardDesc")}</p>
            </div>
          </div>
        </div>
      </section>

      {activeTrip && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          <span>{t("activeRideBlock")}</span>
          <Link href="/oazigo/trips" className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800 transition-colors">
            {t("viewActiveTrip")}
          </Link>
        </div>
      )}

      <ol aria-label={t("bookingSteps")} className="flex items-center gap-2 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
        {(["bookStepRoute", "bookStepRide", "bookStepConfirm"] as const).map((key, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={key} aria-current={active ? "step" : undefined} className="flex flex-1 items-center gap-2 last:flex-none">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${
                done ? "bg-emerald-500 text-white" : active ? "bg-slate-900 text-amber-300 ring-4 ring-amber-300/30" : "bg-slate-100 text-slate-400"
              }`}>
                {done ? <IconCheckCircle size={14} /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-xs font-bold ${active ? "text-slate-900" : done ? "text-emerald-700" : "text-slate-400"}`}>{t(key)}</span>
              {i < 2 && <span aria-hidden="true" className={`h-0.5 flex-1 rounded-full ${done ? "bg-emerald-400" : "bg-slate-200"}`} />}
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
        <div className={`${cardCls} flex flex-col gap-6 border-slate-200/90`}>
          <div className="relative flex flex-col gap-5 pl-6">
            <span aria-hidden="true" className="absolute left-2 top-8 bottom-12 w-px border-l-2 border-dashed border-slate-300" />
            <div className="relative">
              <span aria-hidden="true" className="absolute -left-6 top-7 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 ring-4 ring-amber-100">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-950" />
              </span>
              <RideLocationField
                id="oazigo-pickup"
                label={t("pickupLabel")}
                placeholder={t("pickupPlaceholder")}
                value={pickup}
                onValueChange={setPickup}
                coords={pickupGps}
                onCoordsChange={setPickupGps}
                allowCurrentLocation
              />
            </div>

            <div className="relative">
              <span aria-hidden="true" className="absolute -left-6 top-7 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 ring-4 ring-emerald-100">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              <RideLocationField
                id="oazigo-dropoff"
                label={t("dropoffLabel")}
                placeholder={t("dropoffPlaceholder")}
                value={dropoff}
                onValueChange={setDropoff}
                coords={dropoffGps}
                onCoordsChange={setDropoffGps}
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className={labelCls}>{t("vehicleCategoryLabel")}</p>
            {!quote && <p className="-mt-1 mb-2.5 text-xs text-slate-500">{t("fareAfterRoute")}</p>}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {RIDE_CATEGORIES.map((cat) => {
                const selected = rideCategory === cat;
                const fare = fareFor(cat);
                return (
                  <button
                    type="button" key={cat} onClick={() => setRideCategory(cat)}
                    aria-pressed={selected}
                    className={`group flex flex-col justify-between rounded-2xl border p-3.5 text-left transition-all cursor-pointer ${
                      selected
                        ? "border-slate-900 bg-slate-900 text-white shadow-md shadow-slate-900/10 ring-2 ring-amber-400/70"
                        : "border-slate-200 bg-slate-50/50 text-slate-800 hover:border-amber-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-black tracking-tight ${selected ? "text-amber-300" : "text-slate-900"}`}>
                        {t(`category_${cat}`)}
                      </span>
                      <IconCar size={16} className={selected ? "text-amber-300" : "text-slate-400 group-hover:text-amber-600"} />
                    </div>
                    <span className={`mt-1 block text-[11px] leading-snug ${selected ? "text-slate-300" : "text-slate-500"}`}>
                      {t(`categoryHint_${cat}`)}
                    </span>
                    {fare !== null && (
                      <span className={`mt-2.5 inline-block w-fit rounded-lg px-2 py-0.5 text-xs font-extrabold ${
                        selected ? "bg-amber-400 text-slate-950" : "bg-slate-200/80 text-slate-800"
                      }`}>
                        {fare.toLocaleString(locale)} XAF
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className={labelCls}>{t("transportTypeLabel")}</p>
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-slate-100 p-1.5">
              {(["PASSENGER", "CARGO"] as const).map((type) => (
                <button
                  type="button" key={type} onClick={() => setTransportType(type)}
                  aria-pressed={transportType === type}
                  className={`rounded-xl px-3.5 py-2.5 text-sm font-bold transition-all cursor-pointer ${
                    transportType === type
                      ? "bg-slate-900 text-amber-300 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {type === "PASSENGER" ? t("transportPassenger") : t("transportCargo")}
                </button>
              ))}
            </div>
          </div>

          {transportType === "CARGO" ? (
            <div>
              <label className={labelCls} htmlFor="oazigo-cargo">{t("transportCargo")}</label>
              <input id="oazigo-cargo" required placeholder={t("cargoDescriptionPlaceholder")} value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} className={inputCls} />
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 flex flex-col gap-3">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-800">
                <input type="checkbox" checked={hasLuggage} onChange={(e) => setHasLuggage(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                {t("hasLuggageLabel")}
              </label>
              {hasLuggage && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls} htmlFor="oazigo-luggage-count">{t("luggageCountLabel")}</label>
                      <input
                        id="oazigo-luggage-count" type="number" min={1} max={20} step={1} value={luggageCount}
                        onChange={(e) => setLuggageCount(e.target.value)} className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="oazigo-luggage-size">{t("luggageSizeLabel")}</label>
                      <select id="oazigo-luggage-size" value={luggageSize} onChange={(e) => setLuggageSize(e.target.value as LuggageSize | "")} className={inputCls}>
                        <option value="">{t("luggageSizeChoose")}</option>
                        {LUGGAGE_SIZES.map((size) => <option key={size} value={size}>{t(`luggageSize_${size}`)}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <p className={labelCls}>{t("luggagePhotosLabel")}</p>
                    <p className="mb-2 text-[11px] text-slate-500">{t("luggagePhotosHint")}</p>
                    {luggagePhotos.length > 0 && (
                      <ul className="mb-2 flex flex-wrap gap-2">
                        {luggagePhotos.map((url, i) => (
                          <li key={url} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element -- freshly uploaded preview */}
                            <img src={url} alt={t("luggagePhotoAlt", { n: i + 1 })} className="h-20 w-20 rounded-xl border border-slate-200 object-cover" />
                            <button
                              type="button" onClick={() => setLuggagePhotos((prev) => prev.filter((p) => p !== url))}
                              aria-label={t("luggagePhotoRemove", { n: i + 1 })}
                              className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white cursor-pointer"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {luggagePhotos.length < MAX_LUGGAGE_PHOTOS && (
                      <MediaUploader
                        folder="luggage" accept="image/*" label={t("luggagePhotoAdd")}
                        onUploaded={(result) => setLuggagePhotos((prev) => (prev.length < MAX_LUGGAGE_PHOTOS ? [...prev, result.url] : prev))}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <aside className={`${cardCls} flex flex-col gap-4 border-slate-200/90 lg:sticky lg:top-24`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t("tripSummary")}</p>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
              {t(`category_${rideCategory}`)}
            </span>
          </div>

          {!points ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-5 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                <IconCompass size={22} />
              </span>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">{t("chooseBothPoints")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <RouteStops pickup={pickup} dropoff={dropoff} pickupLabel={t("pickupLabel")} dropoffLabel={t("dropoffLabel")} />
              <RouteMap
                pickup={[points.pickup_latitude, points.pickup_longitude]}
                dropoff={[points.dropoff_latitude, points.dropoff_longitude]}
                polyline={quote?.polyline ?? ""}
                label={t("routeMapLabel")}
              />
              {quoting && <p role="status" className="text-xs font-medium text-slate-500">{t("quoteLoading")}</p>}
              {quote && (
                <p className="rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-bold text-slate-800">
                  {t(quote.source === "google" ? "routeSummary" : "routeSummaryEstimated", { km, time: duration })}
                </p>
              )}
              {quoteFailed && (
                <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {t("quoteFailed")}
                  <button type="button" onClick={retryQuote} className="font-bold underline cursor-pointer">{t("quoteRetry")}</button>
                </p>
              )}
            </div>
          )}

          {quote && selectedFare !== null && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">{t("estimatedFare")}</p>
                <p className="text-[11px] text-emerald-700">{t(quote.source === "google" ? "estimateNote" : "estimateNoteApprox")}</p>
              </div>
              <p className="text-2xl font-black tracking-tight text-emerald-900">
                {selectedFare.toLocaleString(locale)} <span className="text-xs font-bold">XAF</span>
              </p>
            </div>
          )}

          {requestError && (
            <p className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
              <IconAlertCircle size={16} className="mt-0.5 shrink-0" /> {requestError}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-slate-500">{t("payLaterNote")}</p>
          <div className="hidden lg:block">
            <Button size="lg" variant="primary" className="w-full" disabled={requesting || !quote || activeTrip}>
              {requestLabel}
            </Button>
          </div>
        </aside>
      </div>

      {/* On phones the request button follows the page, above the bottom tab bar, so the fare and the action stay in view. */}
      <div className="sticky bottom-[4.5rem] z-30 -mx-1 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-lg backdrop-blur md:bottom-4 lg:hidden">
        <Button size="lg" variant="primary" className="w-full" disabled={requesting || !quote || activeTrip}>
          {requestLabel}
        </Button>
      </div>
    </form>
  );
}

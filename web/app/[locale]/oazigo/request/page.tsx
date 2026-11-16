"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { quoteRide, requestRide, type LuggageSize, type RideQuote } from "@/lib/api";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import { IconAlertCircle } from "@/components/Icons";
import { useOaziGo } from "@/components/oazigo/OaziGoProvider";
import RideLocationField from "@/components/oazigo/RideLocationField";
import RouteMap from "@/components/oazigo/RouteMap";
import { RIDE_CATEGORIES, cardCls, inputCls, labelCls } from "@/components/oazigo/styles";
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
  const { reload } = useOaziGo();

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
      setRequestError(err instanceof Error ? err.message : t("requestFailed"));
      setRequesting(false);
    }
  }

  return (
    <form onSubmit={handleRequest} className={`${cardCls} flex flex-col gap-4`}>
      <h1 className="text-xl font-black tracking-tight text-slate-900">{t("requestRideTitle")}</h1>

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

      <RideLocationField
        id="oazigo-dropoff"
        label={t("dropoffLabel")}
        placeholder={t("dropoffPlaceholder")}
        value={dropoff}
        onValueChange={setDropoff}
        coords={dropoffGps}
        onCoordsChange={setDropoffGps}
      />

      {!points ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">{t("chooseBothPoints")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <RouteMap
            pickup={[points.pickup_latitude, points.pickup_longitude]}
            dropoff={[points.dropoff_latitude, points.dropoff_longitude]}
            polyline={quote?.polyline ?? ""}
            label={t("routeMapLabel")}
          />
          {quoting && <p role="status" className="text-xs text-slate-500">{t("quoteLoading")}</p>}
          {quote && (
            <p className="text-sm font-bold text-slate-800">
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

      <div>
        <p className={labelCls}>{t("vehicleCategoryLabel")}</p>
        <div className="flex flex-wrap gap-2">
          {RIDE_CATEGORIES.map((cat) => (
            <button
              type="button" key={cat} onClick={() => setRideCategory(cat)}
              aria-pressed={rideCategory === cat}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold border transition-colors cursor-pointer text-left ${rideCategory === cat ? "bg-slate-900 text-amber-300 border-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="block">{t(`category_${cat}`)}</span>
              <span className="block text-[11px] font-medium opacity-70">{t(`categoryHint_${cat}`)}</span>
              {fareFor(cat) !== null && <span className="block text-[11px] font-semibold opacity-80">{fareFor(cat)!.toLocaleString(locale)} XAF</span>}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className={labelCls}>{t("transportTypeLabel")}</p>
        <div className="grid grid-cols-2 gap-2">
          {(["PASSENGER", "CARGO"] as const).map((type) => (
            <button
              type="button" key={type} onClick={() => setTransportType(type)}
              aria-pressed={transportType === type}
              className={`rounded-xl px-3.5 py-2.5 text-sm font-bold border transition-colors cursor-pointer ${transportType === type ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
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
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 flex flex-col gap-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-slate-700">
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

      {quote && selectedFare !== null && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">{t("estimatedFare")}</p>
            <p className="text-[11px] text-emerald-700">{t(quote.source === "google" ? "estimateNote" : "estimateNoteApprox")}</p>
          </div>
          <p className="text-xl font-black tracking-tight text-emerald-900">
            {selectedFare.toLocaleString(locale)} <span className="text-xs font-bold">XAF</span>
          </p>
        </div>
      )}

      {requestError && (
        <p className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <IconAlertCircle size={16} className="mt-0.5 shrink-0" /> {requestError}
        </p>
      )}
      <Button size="lg" variant="success" disabled={requesting || !quote}>{requesting ? t("requesting") : t("requestRide")}</Button>
    </form>
  );
}

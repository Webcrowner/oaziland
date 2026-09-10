"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { searchVenues, createVenue, addVenuePhoto, listQuarters, type Venue, type Quarter, type MediaUploadResult } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";

/**
 * Events — now with a real create flow, closing the bigger gap found
 * while adding photo upload: VenueViewSet was read-only, meaning no
 * real venue owner could ever list their own property. Requires at
 * least one real bookable space, matching the backend's own
 * validation.
 */
export default function EventsPage() {
  const t = useTranslations("VenuesPage");
  const tCard = useTranslations("PropertyCard");
  const [venues, setVenues] = useState<Venue[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  const [quarterId, setQuarterId] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [capacityTheatre, setCapacityTheatre] = useState("");
  const [capacityBanquet, setCapacityBanquet] = useState("");
  const [pricePerHour, setPricePerHour] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    searchVenues().then((data) => setVenues(data.results)).catch(() => setVenues([])).finally(() => setStatus("ready"));
  }, []);

  useEffect(() => {
    load();
    listQuarters().then((data) => {
      setQuarters(data);
      if (data.length > 0) setQuarterId(data[0].id);
    }).catch(() => {});
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSubmitStatus("submitting");
    try {
      const venue = await createVenue({
        quarter: quarterId,
        spaces: [{
          space_name: spaceName, capacity_theatre: capacityTheatre ? Number(capacityTheatre) : undefined,
          capacity_banquet: capacityBanquet ? Number(capacityBanquet) : undefined, base_price_per_hour_xaf: pricePerHour,
        }],
      }, token);
      await Promise.all(media.map((m) => addVenuePhoto(venue.id, m.url, m.media_type, token)));
      setShowForm(false);
      setSpaceName(""); setCapacityTheatre(""); setCapacityBanquet(""); setPricePerHour(""); setMedia([]);
      load();
    } catch {
      setSubmitStatus("error");
      return;
    }
    setSubmitStatus("idle");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <PageHeader
        title={t("title")} subtitle={t("subtitle")}
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listYourVenue")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" required>
            {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <input required placeholder={t("spaceNamePlaceholder")} value={spaceName} onChange={(e) => setSpaceName(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />
          <input type="number" placeholder={t("theatreCapacity")} value={capacityTheatre} onChange={(e) => setCapacityTheatre(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input type="number" placeholder={t("banquetCapacity")} value={capacityBanquet} onChange={(e) => setCapacityBanquet(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input required type="number" placeholder={t("pricePerHourPlaceholder")} value={pricePerHour} onChange={(e) => setPricePerHour(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />

          <div className="md:col-span-2">
            <MediaUploader folder="venues" onUploaded={(m) => setMedia((prev) => [...prev, m])} label={t("addPhotoOrVideo")} />
            {media.length > 0 && <p className="text-xs text-gray-500 mt-1">{t("mediaAttached", { count: media.length })}</p>}
          </div>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <p className="text-xs text-gray-500 md:col-span-2">{t("verificationNotice")}</p>
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitVenue")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : venues.length === 0 ? (
        <EmptyState icon="🎉" title={t("noVenuesYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listYourVenue")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {venues.map((venue) => {
            const cheapestSpace = venue.spaces.length
              ? venue.spaces.reduce((min, s) => (Number(s.base_price_per_hour_xaf) < Number(min.base_price_per_hour_xaf) ? s : min))
              : null;
            const photo = venue.photos?.find((p) => p.media_type === "PHOTO");
            return (
              <Card key={venue.id}>
                {photo ? (
                  <div className="h-40 bg-gray-100"><img src={photo.url} alt="" className="w-full h-full object-cover" /></div>
                ) : (
                  <CardMedia label={tCard("noPhotoYet")} />
                )}
                <CardBody>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <p className="text-sm text-gray-500">📍 {venue.quarter_name}</p>
                    {venue.verified ? <Badge variant="green">{t("verifiedBadge")}</Badge> : <Badge variant="gold">{t("pendingReviewBadge")}</Badge>}
                  </div>

                  {venue.spaces[0] && (
                    <div className="flex items-center gap-3 text-sm text-gray-700 mb-2">
                      {venue.spaces[0].capacity_theatre && <span className="flex items-center gap-1">🎭 {venue.spaces[0].capacity_theatre}</span>}
                      {venue.spaces[0].capacity_banquet && <span className="flex items-center gap-1">🍽 {venue.spaces[0].capacity_banquet}</span>}
                    </div>
                  )}

                  <p className="text-xs text-gray-500 mb-2">
                    {venue.spaces.length === 1 ? t("spacesAvailable", { count: venue.spaces.length }) : t("spacesAvailableOther", { count: venue.spaces.length })}
                  </p>

                  {cheapestSpace && (
                    <p className="text-lg font-bold text-[var(--navy)]">
                      {Number(cheapestSpace.base_price_per_hour_xaf).toLocaleString()} XAF
                      <span className="text-sm font-normal text-gray-500"> {t("perHour")}</span>
                    </p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { searchHotels, createHotel, addHotelPhoto, listQuarters, type Hotel, type Quarter, type MediaUploadResult } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";

const ROOM_CATEGORIES = ["STANDARD", "DELUXE", "SUITE", "EXECUTIVE", "FAMILY", "ACCESSIBLE"] as const;

/**
 * Hotels — now with a real create flow, closing the bigger gap found
 * while adding photo upload: HotelViewSet was read-only, meaning no
 * real hotel owner could ever list their own property. A real hotel
 * needs at least one real room type to be bookable, so the form
 * requires one rather than allowing an empty, unusable listing.
 */
export default function HotelsPage() {
  const t = useTranslations("HotelsPage");
  const tCard = useTranslations("PropertyCard");
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  const [quarterId, setQuarterId] = useState("");
  const [starRating, setStarRating] = useState("");
  const [roomCategory, setRoomCategory] = useState<string>("STANDARD");
  const [roomCapacity, setRoomCapacity] = useState("2");
  const [roomRate, setRoomRate] = useState("");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    searchHotels().then((data) => setHotels(data.results)).catch(() => setHotels([])).finally(() => setStatus("ready"));
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
      const hotel = await createHotel({
        quarter: quarterId, star_rating: starRating ? Number(starRating) : undefined,
        room_types: [{ category: roomCategory, capacity: Number(roomCapacity), base_rate_xaf: roomRate }],
      }, token);
      await Promise.all(media.map((m) => addHotelPhoto(hotel.id, m.url, m.media_type, token)));
      setShowForm(false);
      setStarRating(""); setRoomRate(""); setMedia([]);
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
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listYourHotel")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2" required>
            {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <input type="number" min={1} max={5} placeholder={t("starRatingPlaceholder")} value={starRating} onChange={(e) => setStarRating(e.target.value)} className="border rounded-lg px-3 py-2" />

          <p className="md:col-span-2 text-sm font-semibold text-[var(--navy)] mt-2">{t("firstRoomTypeLabel")}</p>
          <select value={roomCategory} onChange={(e) => setRoomCategory(e.target.value)} className="border rounded-lg px-3 py-2">
            {ROOM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="number" min={1} placeholder={t("capacityPlaceholder")} value={roomCapacity} onChange={(e) => setRoomCapacity(e.target.value)} className="border rounded-lg px-3 py-2" />
          <input required type="number" placeholder={t("ratePerNightPlaceholder")} value={roomRate} onChange={(e) => setRoomRate(e.target.value)} className="border rounded-lg px-3 py-2 md:col-span-2" />

          <div className="md:col-span-2">
            <MediaUploader folder="hotels" onUploaded={(m) => setMedia((prev) => [...prev, m])} label={t("addPhotoOrVideo")} />
            {media.length > 0 && <p className="text-xs text-gray-500 mt-1">{t("mediaAttached", { count: media.length })}</p>}
          </div>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <p className="text-xs text-gray-500 md:col-span-2">{t("verificationNotice")}</p>
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitHotel")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : hotels.length === 0 ? (
        <EmptyState icon="🏨" title={t("noHotelsYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listYourHotel")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {hotels.map((hotel) => {
            const cheapestRoom = hotel.room_types.length
              ? hotel.room_types.reduce((min, rt) => (Number(rt.base_rate_xaf) < Number(min.base_rate_xaf) ? rt : min))
              : null;
            const photo = hotel.photos?.find((p) => p.media_type === "PHOTO");

            return (
              <Card key={hotel.id}>
                {photo ? (
                  <div className="h-40 bg-gray-100"><img src={photo.url} alt="" className="w-full h-full object-cover" /></div>
                ) : (
                  <CardMedia label={tCard("noPhotoYet")} />
                )}
                <CardBody>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm text-gray-500">{hotel.quarter_name}</p>
                    {!hotel.verified && <span className="text-xs bg-[var(--gold)]/20 text-[#8A6D14] px-2 py-0.5 rounded font-semibold">{t("pendingReviewBadge")}</span>}
                  </div>
                  {hotel.star_rating && (
                    <p className="text-sm text-[var(--gold)] font-semibold mb-1">
                      {"★".repeat(hotel.star_rating)}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mb-2">
                    {hotel.room_types.length === 1
                      ? t("roomsAvailable", { count: hotel.room_types.length })
                      : t("roomsAvailableOther", { count: hotel.room_types.length })}
                  </p>
                  {cheapestRoom && (
                    <p className="text-lg font-bold text-[var(--navy)]">
                      {t("from")} {Number(cheapestRoom.base_rate_xaf).toLocaleString()} XAF
                      <span className="text-sm font-normal text-gray-500"> {t("perNight")}</span>
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

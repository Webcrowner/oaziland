"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { searchGuestHouses, createGuestHouse, addGuestHousePhoto, listQuarters, type GuestHouse, type Quarter, type MediaUploadResult } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";

/**
 * Guest Houses — now with a real create flow, closing the bigger gap
 * found while adding photo upload: GuestHouseLodgeViewSet was read-
 * only, meaning no real owner could ever list their own property. No
 * verification gate here (unlike Hotels/Events) — a new listing
 * appears immediately, matching the real backend's own design.
 */
export default function GuestHousesPage() {
  const t = useTranslations("GuestHousesPage");
  const tCard = useTranslations("PropertyCard");
  const [guestHouses, setGuestHouses] = useState<GuestHouse[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  const [quarterId, setQuarterId] = useState("");
  const [isCoastalLeisure, setIsCoastalLeisure] = useState(false);
  const [finishLevel, setFinishLevel] = useState("STANDARD");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    searchGuestHouses().then((data) => setGuestHouses(data.results)).catch(() => setGuestHouses([])).finally(() => setStatus("ready"));
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
      const guestHouse = await createGuestHouse({ quarter: quarterId, is_coastal_leisure: isCoastalLeisure, finish_level: finishLevel }, token);
      await Promise.all(media.map((m) => addGuestHousePhoto(guestHouse.id, m.url, m.media_type, token)));
      setShowForm(false);
      setIsCoastalLeisure(false); setMedia([]);
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
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listYourGuestHouse")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2" required>
            {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <select value={finishLevel} onChange={(e) => setFinishLevel(e.target.value)} className="border rounded-lg px-3 py-2">
            <option value="STANDARD">{t("finishStandard")}</option>
            <option value="MODERN">{t("finishModern")}</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
            <input type="checkbox" checked={isCoastalLeisure} onChange={(e) => setIsCoastalLeisure(e.target.checked)} />
            {t("coastalLeisure")}
          </label>

          <div className="md:col-span-2">
            <MediaUploader folder="guest-houses" onUploaded={(m) => setMedia((prev) => [...prev, m])} label={t("addPhotoOrVideo")} />
            {media.length > 0 && <p className="text-xs text-gray-500 mt-1">{t("mediaAttached", { count: media.length })}</p>}
          </div>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitGuestHouse")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : guestHouses.length === 0 ? (
        <EmptyState icon="🏡" title={t("noGuestHousesYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listYourGuestHouse")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {guestHouses.map((gh) => {
            const photo = gh.photos?.find((p) => p.media_type === "PHOTO");
            return (
              <Card key={gh.id}>
                {photo ? (
                  <div className="h-40 bg-gray-100"><img src={photo.url} alt="" className="w-full h-full object-cover" /></div>
                ) : (
                  <CardMedia label={tCard("noPhotoYet")} />
                )}
                <CardBody>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <p className="text-sm text-gray-500">📍 {gh.quarter_name}</p>
                    {gh.is_coastal_leisure && <Badge variant="gold">{t("coastalLeisure")}</Badge>}
                  </div>
                  {gh.amenities.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {gh.amenities.slice(0, 4).map((a) => (
                        <span key={a} className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                          {t(`amenity_${a}`)}
                        </span>
                      ))}
                    </div>
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

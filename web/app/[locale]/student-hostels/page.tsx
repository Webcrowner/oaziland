"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { searchStudentHostels, createStudentHostel, addStudentHostelPhoto, listQuarters, type StudentHostel, type Quarter, type MediaUploadResult } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import Card, { CardMedia, CardBody } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";

const PROPERTY_TYPES = ["BLOCK", "SELF_CONTAIN_COMPOUND", "STUDIO_COMPLEX", "APARTMENT_BUILDING", "MIXED"] as const;

/**
 * Student Hostels — now with a real create flow, closing the bigger
 * gap found while adding photo upload: StudentHostelViewSet was
 * read-only, meaning no real owner could ever list their own hostel.
 */
export default function StudentHostelsPage() {
  const t = useTranslations("StudentHostelsPage");
  const tCard = useTranslations("PropertyCard");
  const [hostels, setHostels] = useState<StudentHostel[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [showForm, setShowForm] = useState(false);

  const [quarterId, setQuarterId] = useState("");
  const [propertyType, setPropertyType] = useState<string>("BLOCK");
  const [media, setMedia] = useState<MediaUploadResult[]>([]);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    searchStudentHostels().then((data) => setHostels(data.results)).catch(() => setHostels([])).finally(() => setStatus("ready"));
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
      const hostel = await createStudentHostel({ quarter: quarterId, property_type: propertyType }, token);
      await Promise.all(media.map((m) => addStudentHostelPhoto(hostel.id, m.url, m.media_type, token)));
      setShowForm(false);
      setMedia([]);
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
        action={<Button onClick={() => setShowForm(!showForm)}>{showForm ? t("cancel") : t("listYourHostel")}</Button>}
      />

      {showForm && (
        <form onSubmit={handleSubmit} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <select value={quarterId} onChange={(e) => setQuarterId(e.target.value)} className="border rounded-lg px-3 py-2" required>
            {quarters.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className="border rounded-lg px-3 py-2">
            {PROPERTY_TYPES.map((pt) => <option key={pt} value={pt}>{pt.replace(/_/g, " ")}</option>)}
          </select>

          <div className="md:col-span-2">
            <MediaUploader folder="student-hostels" onUploaded={(m) => setMedia((prev) => [...prev, m])} label={t("addPhotoOrVideo")} />
            {media.length > 0 && <p className="text-xs text-gray-500 mt-1">{t("mediaAttached", { count: media.length })}</p>}
          </div>
          {submitStatus === "error" && <p className="text-red-600 text-sm md:col-span-2">{t("submitFailed")}</p>}
          <Button className="md:col-span-2" size="lg">{submitStatus === "submitting" ? t("submitting") : t("submitHostel")}</Button>
        </form>
      )}

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : hostels.length === 0 ? (
        <EmptyState icon="🎓" title={t("noHostelsYet")} action={<Button variant="secondary" onClick={() => setShowForm(true)}>{t("listYourHostel")}</Button>} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {hostels.map((hostel) => {
            const totalBeds = hostel.units.reduce((sum, u) => sum + (u.bed_capacity || 0), 0);
            const photo = hostel.photos?.find((p) => p.media_type === "PHOTO");
            return (
              <Card key={hostel.id}>
                {photo ? (
                  <div className="h-40 bg-gray-100"><img src={photo.url} alt="" className="w-full h-full object-cover" /></div>
                ) : (
                  <CardMedia label={tCard("noPhotoYet")} />
                )}
                <CardBody>
                  <p className="text-sm text-gray-500 mb-2">📍 {hostel.quarter_name}</p>

                  <div className="flex items-center gap-3 text-sm text-gray-700 mb-2">
                    {totalBeds > 0 && <span className="flex items-center gap-1">🛏 {totalBeds}</span>}
                    <span>
                      {hostel.units.length === 1 ? t("unitsAvailable", { count: hostel.units.length }) : t("unitsAvailableOther", { count: hostel.units.length })}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {hostel.units.slice(0, 3).map((unit) => (
                      <Badge key={unit.id} variant="navy">{unit.unit_type}</Badge>
                    ))}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

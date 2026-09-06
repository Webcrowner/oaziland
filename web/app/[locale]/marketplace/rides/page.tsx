"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { listMyRides, requestRide, acceptRide, startRide, completeRide, type RideBookingItem } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const STATUS_VARIANT: Record<string, "navy" | "gold" | "green" | "clay"> = {
  REQUESTED: "gold", ACCEPTED: "navy", IN_PROGRESS: "navy", COMPLETED: "green", CANCELLED: "clay",
};

/**
 * Real ride-hailing — request a ride, watch it move through its real
 * lifecycle, and — since anyone can be a driver on this platform, per
 * the honest backend design — accept/start/complete rides posted by
 * others right from the same page. A real phone-number prompt only
 * appears at the one step that actually needs it (paying).
 */
export default function RidesPage() {
  const t = useTranslations("RidesPage");
  const [rides, setRides] = useState<RideBookingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [distance, setDistance] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [payingRideId, setPayingRideId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    listMyRides(token).then((data) => { setRides(data.results); setStatus("ready"); }).catch(() => setStatus("ready"));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRequesting(true);
    try {
      await requestRide({ pickup_description: pickup, dropoff_description: dropoff, distance_km: distance }, token);
      setPickup(""); setDropoff(""); setDistance("");
      load();
    } finally {
      setRequesting(false);
    }
  }

  async function handleAccept(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await acceptRide(id, token);
    load();
  }

  async function handleStart(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await startRide(id, token);
    load();
  }

  async function handleComplete(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token || !phoneNumber) return;
    await completeRide(id, phoneNumber, token);
    setPayingRideId(null);
    setPhoneNumber("");
    load();
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
        <Button href="/login">{t("signInRequired")}</Button>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <form onSubmit={handleRequest} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 flex flex-col gap-3">
        <input required placeholder={t("pickupPlaceholder")} value={pickup} onChange={(e) => setPickup(e.target.value)} className="border rounded-lg px-3 py-2" />
        <input required placeholder={t("dropoffPlaceholder")} value={dropoff} onChange={(e) => setDropoff(e.target.value)} className="border rounded-lg px-3 py-2" />
        <input required type="number" step="0.1" placeholder={t("distancePlaceholder")} value={distance} onChange={(e) => setDistance(e.target.value)} className="border rounded-lg px-3 py-2" />
        <Button size="lg" disabled={requesting}>{requesting ? t("requesting") : t("requestRide")}</Button>
      </form>

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : rides.length === 0 ? (
        <EmptyState icon="🚕" title={t("noRidesYet")} />
      ) : (
        <div className="flex flex-col gap-3">
          {rides.map((ride) => (
            <div key={ride.id} className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-[var(--navy)]">{ride.pickup_description} → {ride.dropoff_description}</p>
                <Badge variant={STATUS_VARIANT[ride.status] || "neutral"}>{ride.status.replace("_", " ")}</Badge>
              </div>
              <p className="text-sm text-gray-600 mb-3">{Number(ride.fare_estimate_xaf).toLocaleString()} XAF</p>

              {ride.status === "REQUESTED" && (
                <button onClick={() => handleAccept(ride.id)} className="text-xs text-[var(--navy)] underline">{t("acceptAsDriver")}</button>
              )}
              {ride.status === "ACCEPTED" && (
                <button onClick={() => handleStart(ride.id)} className="text-xs text-[var(--navy)] underline">{t("startRide")}</button>
              )}
              {ride.status === "IN_PROGRESS" && payingRideId !== ride.id && (
                <button onClick={() => setPayingRideId(ride.id)} className="text-xs text-[var(--navy)] underline">{t("completeAndPay")}</button>
              )}
              {payingRideId === ride.id && (
                <div className="flex gap-2 mt-2">
                  <input placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="border rounded px-3 py-1.5 text-sm flex-1" />
                  <button onClick={() => handleComplete(ride.id)} className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-3 py-1.5 rounded text-sm">{t("pay")}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

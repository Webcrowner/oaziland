"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMyServiceRequests, createServiceRequest, acceptServiceRequest, startServiceRequest, completeServiceRequest,
  type ServiceRequestItem,
} from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

const CATEGORY_LABELS: Record<string, string> = {
  PLUMBING: "Plumbing", ELECTRICAL: "Electrical", PAINTING: "Painting", SURVEYING: "Surveying",
  ARCHITECTURE: "Architecture", CLEANING: "Cleaning", MOVING: "Moving", SECURITY_INSTALLATION: "Security Installation",
};
const STATUS_VARIANT: Record<string, "navy" | "gold" | "green" | "clay"> = {
  REQUESTED: "gold", ACCEPTED: "navy", EN_ROUTE: "navy", IN_PROGRESS: "navy", COMPLETED: "green", CANCELLED: "clay", DISPUTED: "clay",
};

/**
 * Taskln Service — real on-demand technician dispatch, branded
 * "Taskln Service" in the interface per the founder's naming, backed
 * by the "services" app (already Taskln-scoped in its own backend
 * docstrings — a deliberately narrower subset of Glorentech's
 * separate Taskln workforce platform). Same real request → accept →
 * start → complete-and-pay lifecycle as Rides, distinct visual
 * identity to avoid confusion with the unrelated Partner Services
 * Directory at /services.
 */
export default function TasklnServicePage() {
  const t = useTranslations("TasklnServicePage");
  const [requests, setRequests] = useState<ServiceRequestItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [category, setCategory] = useState("PLUMBING");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("SCHEDULED");
  const [requesting, setRequesting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    listMyServiceRequests(token).then((data) => { setRequests(data.results); setStatus("ready"); }).catch(() => setStatus("ready"));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRequesting(true);
    try {
      await createServiceRequest({ category, description, priority }, token);
      setDescription("");
      load();
    } finally {
      setRequesting(false);
    }
  }

  async function handleAccept(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await acceptServiceRequest(id, token);
    load();
  }

  async function handleStart(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await startServiceRequest(id, token);
    load();
  }

  async function handleComplete(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token || !amount || !phoneNumber) return;
    await completeServiceRequest(id, amount, phoneNumber, token);
    setPayingId(null);
    setAmount(""); setPhoneNumber("");
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
      <PageHeader
        title={t("title")} subtitle={t("subtitle")}
        action={<Link href="/technician-dashboard" className="text-sm text-[var(--navy)] underline whitespace-nowrap">{t("technicianDashboard")}</Link>}
      />

      <form onSubmit={handleRequest} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded-lg px-3 py-2">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="border rounded-lg px-3 py-2">
            <option value="SCHEDULED">{t("scheduled")}</option>
            <option value="URGENT">{t("urgent")}</option>
          </select>
        </div>
        <textarea required rows={3} placeholder={t("descriptionPlaceholder")} value={description} onChange={(e) => setDescription(e.target.value)} className="border rounded-lg px-3 py-2" />
        <Button size="lg" disabled={requesting}>{requesting ? t("requesting") : t("requestTaskln")}</Button>
      </form>

      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : requests.length === 0 ? (
        <EmptyState icon="🛠️" title={t("noRequestsYet")} />
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((request) => (
            <div key={request.id} className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-[var(--navy)]">{CATEGORY_LABELS[request.category]}</p>
                <div className="flex gap-2">
                  {request.priority === "URGENT" && <Badge variant="clay">{t("urgent")}</Badge>}
                  <Badge variant={STATUS_VARIANT[request.status] || "neutral"}>{request.status.replace("_", " ")}</Badge>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3">{request.description}</p>

              {request.status === "REQUESTED" && (
                <button onClick={() => handleAccept(request.id)} className="text-xs text-[var(--navy)] underline">{t("acceptAsTechnician")}</button>
              )}
              {request.status === "ACCEPTED" && (
                <button onClick={() => handleStart(request.id)} className="text-xs text-[var(--navy)] underline">{t("startJob")}</button>
              )}
              {request.status === "IN_PROGRESS" && payingId !== request.id && (
                <button onClick={() => setPayingId(request.id)} className="text-xs text-[var(--navy)] underline">{t("completeAndPay")}</button>
              )}
              {payingId === request.id && (
                <div className="flex flex-col sm:flex-row gap-2 mt-2">
                  <input type="number" placeholder={t("amountPlaceholder")} value={amount} onChange={(e) => setAmount(e.target.value)} className="border rounded px-3 py-1.5 text-sm flex-1" />
                  <input placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="border rounded px-3 py-1.5 text-sm flex-1" />
                  <button onClick={() => handleComplete(request.id)} className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-3 py-1.5 rounded text-sm whitespace-nowrap">{t("pay")}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

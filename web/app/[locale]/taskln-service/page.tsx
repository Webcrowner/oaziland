"use client";
import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMyServiceRequests, createServiceRequest, acceptServiceRequest, startServiceRequest, completeServiceRequest,
  cancelServiceRequest, getMyTechnicianProfile, registerAsTechnician, getMyProfile, uploadServiceRequestPhoto,
  releaseServiceRequest, markServiceRequestEnRoute, proposeServiceQuote, approveServiceQuote, disputeServiceRequest,
  rateServiceTechnician, getServiceReceipt, rescheduleServiceRequest,
  type ServiceRequestItem, type TechnicianProfileItem, type MediaUploadResult, type ServiceReceipt,
} from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import TechnicianDocuments from "@/components/TechnicianDocuments";
import ServiceRequestChat from "@/components/ServiceRequestChat";
import GpsCaptureButton from "@/components/GpsCaptureButton";
import { IconMapPin } from "@/components/Icons";
import { useTasklnLabels, TASKLN_CATEGORY_CODES } from "@/lib/useTasklnLabels";

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
  const labels = useTasklnLabels();
  const [requests, setRequests] = useState<ServiceRequestItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [category, setCategory] = useState("PLUMBING");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("SCHEDULED");
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number | null; longitude: number | null }>({
    latitude: null,
    longitude: null,
  });
  const [requesting, setRequesting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [quoteInputs, setQuoteInputs] = useState<Record<string, string>>({});
  const [materialsInputs, setMaterialsInputs] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<ServiceReceipt | null>(null);
  const [newScheduledFor, setNewScheduledFor] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [actionError, setActionError] = useState("");

  // Technician self-registration — the real gap this closes:
  // previously ANY signed-in user could accept a job with zero
  // registration (the same bug already fixed for OaziGo drivers).
  const [technicianProfile, setTechnicianProfile] = useState<TechnicianProfileItem | null>(null);
  const [showTechnicianForm, setShowTechnicianForm] = useState(false);
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [registeringTechnician, setRegisteringTechnician] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([listMyServiceRequests(token), getMyTechnicianProfile(token), getMyProfile(token)]).then(([requestsData, profile, myProfile]) => {
      setRequests(requestsData.results);
      setTechnicianProfile(profile);
      setMyUserId(myProfile.id);
      setStatus("ready");
    }).catch(() => setStatus("ready"));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRegisterTechnician(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || selectedSpecialties.length === 0) return;
    setRegisteringTechnician(true);
    try {
      await registerAsTechnician(selectedSpecialties, undefined, token);
      setShowTechnicianForm(false);
      load();
    } finally {
      setRegisteringTechnician(false);
    }
  }

  function toggleSpecialty(value: string) {
    setSelectedSpecialties((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRequesting(true);
    setActionError("");
    try {
      await createServiceRequest(
        {
          category,
          description,
          priority,
          scheduled_for: newScheduledFor ? new Date(newScheduledFor).toISOString() : undefined,
          latitude: gpsCoords.latitude ?? undefined,
          longitude: gpsCoords.longitude ?? undefined,
        },
        token
      );
      setDescription("");
      setNewScheduledFor("");
      setGpsCoords({ latitude: null, longitude: null });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setRequesting(false);
    }
  }

  // Runs a job action with the stored token, surfacing any server error instead of failing silently.
  async function runAction(fn: (token: string) => Promise<unknown>) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setActionError("");
    try {
      await fn(token);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  const handleAccept = (id: string) => runAction((token) => acceptServiceRequest(id, token));
  const handleRelease = (id: string) => runAction((token) => releaseServiceRequest(id, token));
  const handleStart = (id: string) => runAction((token) => startServiceRequest(id, token));
  const handleApproveQuote = (id: string) => runAction((token) => approveServiceQuote(id, token));
  const handleRate = (id: string, score: number) => runAction((token) => rateServiceTechnician(id, score, token));

  function handleEnRoute(id: string) {
    // Share the technician's live position with the requester when the browser allows it.
    if (!navigator.geolocation) {
      runAction((token) => markServiceRequestEnRoute(id, token));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => runAction((token) => markServiceRequestEnRoute(id, token, { latitude: pos.coords.latitude, longitude: pos.coords.longitude })),
      () => runAction((token) => markServiceRequestEnRoute(id, token)),
    );
  }

  async function handleSendQuote(id: string) {
    const value = quoteInputs[id];
    if (!value) return;
    await runAction((token) => proposeServiceQuote(id, { laborXaf: value, materialsXaf: materialsInputs[id] }, token));
    setQuoteInputs((prev) => ({ ...prev, [id]: "" }));
    setMaterialsInputs((prev) => ({ ...prev, [id]: "" }));
  }

  async function handleShowReceipt(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setActionError("");
    try {
      setReceipt(await getServiceReceipt(id, token));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("receiptFailed"));
    }
  }

  async function handleDispute(id: string) {
    await runAction((token) => disputeServiceRequest(id, disputeReason, token));
    setDisputeId(null);
    setDisputeReason("");
  }

  async function handleCancel(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setCancellingId(id);
    try {
      await cancelServiceRequest(id, token);
      load();
    } finally {
      setCancellingId(null);
    }
  }

  async function handleComplete(id: string) {
    if (!phoneNumber) return;
    await runAction((token) => completeServiceRequest(id, phoneNumber, token));
    setPayingId(null);
    setPhoneNumber("");
  }

  async function handlePhotoUploaded(requestId: string, photoType: "BEFORE" | "AFTER", result: MediaUploadResult) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await uploadServiceRequestPhoto(requestId, photoType, result.url, token);
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
        action={
          <div className="flex gap-4">
            <Link href="/technicians" className="text-sm text-[var(--navy)] underline whitespace-nowrap">{t("findTechnician")}</Link>
            <Link href="/technician-dashboard" className="text-sm text-[var(--navy)] underline whitespace-nowrap">{t("technicianDashboard")}</Link>
          </div>
        }
      />

      <form onSubmit={handleRequest} className="border border-gray-200 rounded-xl p-6 bg-white mb-8 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded-lg px-3 py-2">
            {TASKLN_CATEGORY_CODES.map((value) => <option key={value} value={value}>{labels.category(value)}</option>)}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="border rounded-lg px-3 py-2">
            <option value="SCHEDULED">{t("scheduled")}</option>
            <option value="URGENT">{t("urgent")}</option>
          </select>
        </div>
        <textarea required rows={3} placeholder={t("descriptionPlaceholder")} value={description} onChange={(e) => setDescription(e.target.value)} className="border rounded-lg px-3 py-2" />
        <label className="text-xs text-gray-500">
          {t("whenNeeded")}
          <input type="datetime-local" value={newScheduledFor} onChange={(e) => setNewScheduledFor(e.target.value)} className="border rounded-lg px-3 py-2 text-sm w-full mt-1" />
        </label>
        <div className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-1">
            {t("siteLocationLabel")}
          </label>
          <GpsCaptureButton
            onCapture={(coords) => setGpsCoords(coords)}
            currentCoords={gpsCoords}
            label={t("captureSiteGps")}
          />
        </div>
        <Button size="lg" disabled={requesting || gpsCoords.latitude === null}>{requesting ? t("requesting") : t("requestTaskln")}</Button>
        {gpsCoords.latitude === null && <p className="text-xs text-gray-500">{t("captureGpsHint")}</p>}
      </form>

      <div className="border border-gray-200 rounded-xl p-5 bg-white mb-8">
        {technicianProfile ? (
          <>
            {technicianProfile.is_verified ? (
              <p className="text-sm text-emerald-700">✓ {t("registeredTechnician")}: {technicianProfile.specialties.map((s) => labels.category(s)).join(", ")}</p>
            ) : (
              <p className="text-sm text-gray-500">{t("technicianPendingVerification")}</p>
            )}
            <TechnicianDocuments profile={technicianProfile} onSaved={setTechnicianProfile} />
          </>
        ) : showTechnicianForm ? (
          <form onSubmit={handleRegisterTechnician} className="flex flex-col gap-3">
            <p className="text-xs text-gray-500">{t("selectSpecialties")}</p>
            <div className="flex flex-wrap gap-2">
              {TASKLN_CATEGORY_CODES.map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => toggleSpecialty(value)}
                  className={`text-xs px-3 py-1.5 rounded-full border ${selectedSpecialties.includes(value) ? "bg-[var(--navy)] text-white border-[var(--navy)]" : "border-gray-300 text-gray-600"}`}
                >
                  {labels.category(value)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button disabled={registeringTechnician || selectedSpecialties.length === 0}>{registeringTechnician ? t("requesting") : t("submitRegistration")}</Button>
              <button type="button" onClick={() => setShowTechnicianForm(false)} className="text-xs text-gray-500 underline">{t("cancel")}</button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setShowTechnicianForm(true)}>{t("registerAsTechnician")}</Button>
        )}
      </div>

      {actionError && <p className="text-sm text-red-600 mb-3">{actionError}</p>}
      {receipt && (
        <div className="border border-gray-300 rounded-xl p-5 bg-white mb-4 text-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="font-bold text-[var(--navy)]">{t("receiptTitle", { number: receipt.receipt_number.slice(0, 8).toUpperCase() })}</p>
            <button onClick={() => setReceipt(null)} className="text-xs text-gray-500 underline">{t("close")}</button>
          </div>
          <p className="text-gray-600">{labels.category(receipt.category_code)}: {receipt.description}</p>
          <p className="text-xs text-gray-500 mb-3">{t("receiptParties", { requester: receipt.requester_name, technician: receipt.technician_name || t("technicianFallback") })}{receipt.completed_at ? ` · ${new Date(receipt.completed_at).toLocaleDateString()}` : ""}</p>
          {receipt.labor_xaf && <p className="flex justify-between"><span>{t("receiptLabor")}</span><span>{Number(receipt.labor_xaf).toLocaleString()} XAF</span></p>}
          {receipt.materials_xaf && <p className="flex justify-between"><span>{t("receiptMaterials")}</span><span>{Number(receipt.materials_xaf).toLocaleString()} XAF</span></p>}
          <p className="flex justify-between font-bold border-t mt-2 pt-2"><span>{t("receiptTotal")}</span><span>{Number(receipt.total_xaf).toLocaleString()} XAF</span></p>
          {receipt.platform_fee_xaf && <p className="flex justify-between text-xs text-gray-500 mt-1"><span>{t("receiptFee")}</span><span>{Number(receipt.platform_fee_xaf).toLocaleString()} XAF</span></p>}
          {receipt.technician_payout_xaf && <p className="flex justify-between text-xs text-gray-500"><span>{t("receiptPayout")}</span><span>{Number(receipt.technician_payout_xaf).toLocaleString()} XAF</span></p>}
        </div>
      )}
      {status === "loading" ? (
        <p className="text-gray-400">...</p>
      ) : requests.length === 0 ? (
        <EmptyState icon="🛠️" title={t("noRequestsYet")} />
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((request) => (
            <div key={request.id} className="border border-gray-200 rounded-xl p-4 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-[var(--navy)]">{labels.category(request.category)}</p>
                <div className="flex gap-2">
                  {request.priority === "URGENT" && <Badge variant="clay">{t("urgent")}</Badge>}
                  <Badge variant={STATUS_VARIANT[request.status] || "neutral"}>{labels.status(request.status)}</Badge>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-3">{request.description}</p>
              {request.scheduled_for && (
                <p className="text-xs text-slate-600 mb-3">{t("scheduledFor", { date: new Date(request.scheduled_for).toLocaleString() })}</p>
              )}

              {request.latitude && request.longitude && request.requester !== myUserId && request.technician !== myUserId && (
                <p className="text-xs text-slate-500 mb-3">{t("approximateArea")}</p>
              )}
              {request.latitude && request.longitude && (request.requester === myUserId || request.technician === myUserId) && (
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3 p-2.5 bg-slate-50 rounded-xl border border-slate-200/80">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 font-mono">
                    <IconMapPin size={13} className="text-amber-500" />
                    <span>{t("siteGps")}: {Number(request.latitude).toFixed(5)}, {Number(request.longitude).toFixed(5)}</span>
                  </div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${request.latitude},${request.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition-colors shadow-2xs"
                    title={t("followToSite")}
                  >
                    <span>{t("followToSite")} ↗</span>
                  </a>
                </div>
              )}

              {request.quoted_amount_xaf && (
                <p className="text-sm mb-3">
                  <span className="font-semibold">{t("quote")}: {Number(request.quoted_amount_xaf).toLocaleString()} XAF</span>{" "}
                  <span className={request.quote_approved ? "text-emerald-700" : "text-amber-700"}>
                    {request.quote_approved ? t("quoteApproved") : t("quoteAwaiting")}
                  </span>
                </p>
              )}
              {request.status === "DISPUTED" && request.dispute_reason && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2 mb-3">{t("disputedLabel")}: {request.dispute_reason}</p>
              )}
              {request.technician_location && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${request.technician_location.latitude},${request.technician_location.longitude}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-block text-xs font-bold text-[var(--navy)] underline mb-3"
                >
                  {t("whereIsTechnician")} ↗
                </a>
              )}

              {(() => {
                const isRequester = request.requester === myUserId;
                const isAssignedTechnician = request.technician === myUserId;
                const active = ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(request.status);
                const linkClass = "text-xs text-[var(--navy)] underline";
                return (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {request.status === "REQUESTED" && !isRequester && technicianProfile?.is_verified && (
                        <button onClick={() => handleAccept(request.id)} className={linkClass}>{t("acceptAsTechnician")}</button>
                      )}
                      {request.status === "REQUESTED" && isRequester && (
                        <button onClick={() => handleCancel(request.id)} disabled={cancellingId === request.id} className="text-xs text-gray-500 underline disabled:opacity-50">
                          {cancellingId === request.id ? t("cancelling") : t("cancelRequest")}
                        </button>
                      )}
                      {isAssignedTechnician && request.status === "ACCEPTED" && (
                        <button onClick={() => handleEnRoute(request.id)} className={linkClass}>{t("onMyWay")}</button>
                      )}
                      {isAssignedTechnician && ["ACCEPTED", "EN_ROUTE"].includes(request.status) && (
                        <>
                          <button onClick={() => handleStart(request.id)} disabled={!request.quote_approved} title={request.quote_approved ? "" : t("startWaitingApproval")} className={`${linkClass} disabled:opacity-40 disabled:no-underline`}>{t("startJob")}</button>
                          <button onClick={() => handleRelease(request.id)} className="text-xs text-gray-500 underline">{t("releaseJob")}</button>
                        </>
                      )}
                      {isRequester && request.quoted_amount_xaf && !request.quote_approved && active && (
                        <button onClick={() => handleApproveQuote(request.id)} className="text-xs font-bold bg-emerald-600 text-white px-3 py-1 rounded-lg">{t("approveQuote")}</button>
                      )}
                      {isRequester && request.status === "IN_PROGRESS" && request.quote_approved && payingId !== request.id && (
                        <button onClick={() => setPayingId(request.id)} className={linkClass}>{t("completeAndPay")}</button>
                      )}
                      {(isRequester || isAssignedTechnician) && active && disputeId !== request.id && (
                        <button onClick={() => setDisputeId(request.id)} className="text-xs text-red-600 underline">{t("reportProblem")}</button>
                      )}
                    </div>

                    {isAssignedTechnician && active && (
                      <div className="flex flex-wrap gap-2">
                        <input type="number" min="0" placeholder={request.quoted_amount_xaf ? t("reviseLaborPlaceholder") : t("laborPlaceholder")} value={quoteInputs[request.id] || ""} onChange={(e) => setQuoteInputs((prev) => ({ ...prev, [request.id]: e.target.value }))} className="border rounded px-3 py-1.5 text-sm flex-1 min-w-28" />
                        <input type="number" min="0" placeholder={t("materialsPlaceholder")} value={materialsInputs[request.id] || ""} onChange={(e) => setMaterialsInputs((prev) => ({ ...prev, [request.id]: e.target.value }))} className="border rounded px-3 py-1.5 text-sm flex-1 min-w-28" />
                        <button onClick={() => handleSendQuote(request.id)} className="bg-[var(--navy)] text-white font-semibold px-3 py-1.5 rounded text-sm whitespace-nowrap">{t("sendQuote")}</button>
                      </div>
                    )}

                    {payingId === request.id && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="border rounded px-3 py-1.5 text-sm flex-1" />
                        <button onClick={() => handleComplete(request.id)} className="bg-[var(--gold)] text-[var(--navy)] font-semibold px-3 py-1.5 rounded text-sm whitespace-nowrap">{t("pay")} {Number(request.quoted_amount_xaf).toLocaleString()} XAF</button>
                      </div>
                    )}

                    {disputeId === request.id && (
                      <div className="flex flex-col gap-2">
                        <textarea rows={2} placeholder={t("disputePlaceholder")} value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} className="border rounded px-3 py-1.5 text-sm" />
                        <div className="flex gap-2">
                          <button onClick={() => handleDispute(request.id)} disabled={disputeReason.trim().length < 5} className="bg-red-600 text-white font-semibold px-3 py-1.5 rounded text-sm disabled:opacity-50">{t("submitDispute")}</button>
                          <button onClick={() => setDisputeId(null)} className="text-xs text-gray-500 underline">{t("cancel")}</button>
                        </div>
                      </div>
                    )}

                    {(isRequester || isAssignedTechnician) && request.status === "COMPLETED" && (
                      <button onClick={() => handleShowReceipt(request.id)} className={linkClass}>{t("viewReceipt")}</button>
                    )}

                    {request.technician && (isRequester || isAssignedTechnician) && request.status !== "CANCELLED" && (
                      <div className="flex flex-col gap-2">
                        <button onClick={() => setChatId(chatId === request.id ? null : request.id)} className={`${linkClass} self-start`}>
                          {chatId === request.id ? t("hideChat") : t("chat")}
                        </button>
                        {chatId === request.id && <ServiceRequestChat requestId={request.id} myUserId={myUserId} />}
                      </div>
                    )}

                    {(isRequester || isAssignedTechnician) && ["REQUESTED", "ACCEPTED", "EN_ROUTE"].includes(request.status) && (isRequester || request.status !== "REQUESTED") && (
                      rescheduleId === request.id ? (
                        <div className="flex gap-2">
                          <input type="datetime-local" value={rescheduleValue} onChange={(e) => setRescheduleValue(e.target.value)} className="border rounded px-3 py-1.5 text-sm flex-1" />
                          <button
                            disabled={!rescheduleValue}
                            onClick={async () => { await runAction((token) => rescheduleServiceRequest(request.id, new Date(rescheduleValue).toISOString(), token)); setRescheduleId(null); setRescheduleValue(""); }}
                            className="bg-[var(--navy)] text-white font-semibold px-3 py-1.5 rounded text-sm disabled:opacity-50"
                          >
                            {t("save")}
                          </button>
                          <button onClick={() => setRescheduleId(null)} className="text-xs text-gray-500 underline">{t("cancel")}</button>
                        </div>
                      ) : (
                        <button onClick={() => setRescheduleId(request.id)} className={`${linkClass} self-start`}>{t("reschedule")}</button>
                      )
                    )}

                    {isRequester && request.status === "COMPLETED" && request.technician && (
                      <div className="flex items-center gap-1 text-xs text-gray-600">
                        <span>{t("rateTechnician", { name: request.technician_name || t("yourTechnician") })}</span>
                        {[1, 2, 3, 4, 5].map((score) => (
                          <button key={score} onClick={() => handleRate(request.id, score)} className="px-2 py-1 rounded border border-gray-200 hover:bg-amber-50" aria-label={`${score} stars`}>{score}★</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {["ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "DISPUTED"].includes(request.status) &&
                (request.requester === myUserId || request.technician === myUserId) && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-2">{t("jobPhotos")}</p>
                  {request.photos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {request.photos.map((photo) => (
                        <a key={photo.id} href={photo.file_url} target="_blank" rel="noopener noreferrer" className="block">
                          <img src={photo.file_url} alt={photo.photo_type} className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                          <span className="text-[10px] text-gray-400">{photo.photo_type === "BEFORE" ? t("photoBefore") : t("photoAfter")}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <MediaUploader folder="services" label={t("addBeforePhoto")} onUploaded={(result) => handlePhotoUploaded(request.id, "BEFORE", result)} />
                    <MediaUploader folder="services" label={t("addAfterPhoto")} onUploaded={(result) => handlePhotoUploaded(request.id, "AFTER", result)} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

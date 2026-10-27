"use client";
import { useState, useEffect, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listMyServiceRequests, createServiceRequest, acceptServiceRequest, startServiceRequest, completeServiceRequest,
  cancelServiceRequest, getMyTechnicianProfile, registerAsTechnician, getMyProfile, uploadServiceRequestPhoto,
  releaseServiceRequest, markServiceRequestEnRoute, proposeServiceQuote, approveServiceQuote, disputeServiceRequest,
  rateServiceTechnician, getServiceReceipt, rescheduleServiceRequest, fundServiceRequest,
  declineServiceRequest, openServiceRequestToAll, listTechnicianDirectory, submitTechnicianLocationPing,
  rejectServiceQuote, dismissServiceTechnician, markServiceWorkDone, rateServiceRequester,
  type ServiceRequestItem, type TechnicianProfileItem, type MediaUploadResult, type ServiceReceipt, type TechnicianDirectoryItem,
  type ServiceRequestScope,
} from "@/lib/api";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import MediaUploader from "@/components/MediaUploader";
import TechnicianDocuments from "@/components/TechnicianDocuments";
import ServiceRequestChat from "@/components/ServiceRequestChat";
import GpsCaptureButton from "@/components/GpsCaptureButton";
import { IconMapPin, IconWrench, IconCheckCircle, IconAlertCircle, IconChevronRight } from "@/components/Icons";
import { useTasklnLabels, TASKLN_CATEGORY_CODES } from "@/lib/useTasklnLabels";

// text-base on phones stops iOS Safari from zooming into focused fields; min-h keeps touch targets comfortable.
const inputCls =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";
const cardCls = "rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-sm";
const pillBtnCls = "rounded-xl border border-slate-200 bg-white px-3.5 py-2 min-h-10 sm:min-h-0 text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const solidBtnCls = "rounded-xl bg-slate-900 px-4 py-2 min-h-10 sm:min-h-0 text-xs font-bold text-amber-300 hover:bg-slate-800 active:scale-[0.98] transition whitespace-nowrap cursor-pointer disabled:opacity-50";
const dangerBtnCls = "rounded-xl border border-red-200 bg-white px-3.5 py-2 min-h-10 sm:min-h-0 text-xs font-bold text-red-700 hover:bg-red-50 active:scale-[0.98] transition cursor-pointer disabled:opacity-50";

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
  const locale = useLocale();
  const labels = useTasklnLabels();
  const formatDate = (value: string) => new Date(value).toLocaleDateString(locale);
  const formatDateTime = (value: string) => new Date(value).toLocaleString(locale);
  // Earliest selectable schedule time, in the local format datetime-local expects.
  const nowLocalInput = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  };
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
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [quoteInputs, setQuoteInputs] = useState<Record<string, string>>({});
  const [materialsInputs, setMaterialsInputs] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<ServiceReceipt | null>(null);
  const [newScheduledFor, setNewScheduledFor] = useState("");
  const [addressNote, setAddressNote] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [problemPhotos, setProblemPhotos] = useState<string[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [registerError, setRegisterError] = useState("");

  // Technician self-registration — the real gap this closes:
  // previously ANY signed-in user could accept a job with zero
  // registration (the same bug already fixed for OaziGo drivers).
  const [technicianProfile, setTechnicianProfile] = useState<TechnicianProfileItem | null>(null);
  const [showTechnicianForm, setShowTechnicianForm] = useState(false);
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [registeringTechnician, setRegisteringTechnician] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // Technician picked from the directory (?technician=<id>); the request goes only to them.
  const [chosenTechnician, setChosenTechnician] = useState<TechnicianDirectoryItem | null>(null);
  const [chosenTechnicianMissing, setChosenTechnicianMissing] = useState(false);
  // How far from the technician's last shared position the job board reaches (km, or "all").
  const [boardRadius, setBoardRadius] = useState("30");
  const [sharingLocation, setSharingLocation] = useState(false);
  // Each list (my requests / my jobs / job board) is paged separately on the server.
  const [tab, setTab] = useState<ServiceRequestScope>("mine");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    Promise.all([listMyServiceRequests(token, { scope: tab, radiusKm: boardRadius }), getMyTechnicianProfile(token), getMyProfile(token)]).then(([requestsData, profile, myProfile]) => {
      setRequests(requestsData.results);
      setPage(1);
      setHasMore(Boolean(requestsData.next));
      setTotalCount(requestsData.count);
      setTechnicianProfile(profile);
      setMyUserId(myProfile.id);
      setLoadError(false);
      setStatus("ready");
    }).catch(() => {
      setLoadError(true);
      setStatus("ready");
    }).finally(() => setListLoading(false));
  }, [tab, boardRadius]);

  function changeTab(next: ServiceRequestScope) {
    if (next === tab) return;
    setListLoading(true);
    setActionError("");
    setTab(next);
  }

  async function handleLoadMore() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoadingMore(true);
    try {
      const data = await listMyServiceRequests(token, { scope: tab, radiusKm: boardRadius, page: page + 1 });
      setRequests((prev) => [...prev, ...data.results.filter((item) => !prev.some((p) => p.id === item.id))]);
      setPage(page + 1);
      setHasMore(Boolean(data.next));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  useEffect(() => {
    const technicianId = new URLSearchParams(window.location.search).get("technician");
    if (!technicianId) return;
    listTechnicianDirectory(undefined, technicianId)
      .then((rows) => {
        if (rows.length === 0) {
          setChosenTechnicianMissing(true);
          return;
        }
        setChosenTechnician(rows[0]);
        setCategory((current) => (rows[0].specialties.includes(current) ? current : rows[0].specialties[0] ?? current));
      })
      .catch(() => setChosenTechnicianMissing(true));
  }, []);

  async function handleRegisterTechnician(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || selectedSpecialties.length === 0) return;
    setRegisteringTechnician(true);
    setRegisterError("");
    try {
      await registerAsTechnician(selectedSpecialties, undefined, token);
      setShowTechnicianForm(false);
      setSelectedSpecialties([]);
      load();
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setRegisteringTechnician(false);
    }
  }

  function handleShareLocation() {
    const token = localStorage.getItem("access_token");
    if (!token || !navigator.geolocation) {
      setActionError(t("locationUnavailable"));
      return;
    }
    setSharingLocation(true);
    setActionError("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await submitTechnicianLocationPing(pos.coords.latitude, pos.coords.longitude, token);
          load();
        } catch (err) {
          setActionError(err instanceof Error ? err.message : t("actionFailed"));
        } finally {
          setSharingLocation(false);
        }
      },
      () => {
        setActionError(t("locationUnavailable"));
        setSharingLocation(false);
      },
    );
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
    setNotice("");
    try {
      await createServiceRequest(
        {
          category,
          description: description.trim(),
          priority,
          scheduled_for: priority !== "URGENT" && newScheduledFor ? new Date(newScheduledFor).toISOString() : undefined,
          address_note: addressNote.trim() || undefined,
          area_label: areaLabel.trim() || undefined,
          photo_urls: problemPhotos.length > 0 ? problemPhotos : undefined,
          requested_technician: chosenTechnician?.user_id,
          latitude: gpsCoords.latitude ?? undefined,
          longitude: gpsCoords.longitude ?? undefined,
        },
        token
      );
      setDescription("");
      setNewScheduledFor("");
      setAddressNote("");
      setAreaLabel("");
      setProblemPhotos([]);
      setGpsCoords({ latitude: null, longitude: null });
      setChosenTechnician(null);
      setNotice(t("requestCreated"));
      if (tab === "mine") load();
      else changeTab("mine");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setRequesting(false);
    }
  }

  // Runs a job action with the stored token, surfacing any server error instead of failing silently.
  // Resolves to whether the action succeeded so callers keep their form open on failure.
  async function runAction(fn: (token: string) => Promise<unknown>): Promise<boolean> {
    const token = localStorage.getItem("access_token");
    if (!token) return false;
    setActionError("");
    setNotice("");
    try {
      await fn(token);
      load();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("actionFailed"));
      return false;
    }
  }

  const handleAccept = (id: string) => runAction((token) => acceptServiceRequest(id, token));
  const handleRelease = (id: string) => runAction((token) => releaseServiceRequest(id, token));
  const handleDecline = (id: string) => runAction((token) => declineServiceRequest(id, token));
  const handleOpenToAll = (id: string) => runAction((token) => openServiceRequestToAll(id, token));
  const handleRejectQuote = (id: string) => runAction((token) => rejectServiceQuote(id, token));
  const handleWorkDone = (id: string) => runAction((token) => markServiceWorkDone(id, token));
  function handleDismissTechnician(id: string) {
    if (!window.confirm(t("confirmDismissQuestion"))) return;
    runAction((token) => dismissServiceTechnician(id, token));
  }
  const handleStart = (id: string) => runAction((token) => startServiceRequest(id, token));
  const handleApproveQuote = (id: string) => runAction((token) => approveServiceQuote(id, token));
  const handleRate = (id: string, score: number, comment: string) => runAction((token) => rateServiceTechnician(id, score, token, comment));
  const handleRateClient = (id: string, score: number, comment: string) => runAction((token) => rateServiceRequester(id, score, token, comment));
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { score: number; comment: string }>>({});
  const [reviewEditId, setReviewEditId] = useState<string | null>(null);

  async function handleSubmitReview(request: ServiceRequestItem, asRequester: boolean) {
    const draft = reviewDrafts[request.id];
    if (!draft?.score) return;
    const ok = await (asRequester ? handleRate : handleRateClient)(request.id, draft.score, draft.comment.trim());
    if (ok) setReviewEditId(null);
  }

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
    const ok = await runAction((token) => proposeServiceQuote(id, { laborXaf: value, materialsXaf: materialsInputs[id] }, token));
    if (!ok) return;
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
    if (await runAction((token) => disputeServiceRequest(id, disputeReason.trim(), token))) {
      setDisputeId(null);
      setDisputeReason("");
    }
  }

  async function handleCancel(id: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (!window.confirm(t("confirmCancelQuestion"))) return;
    setCancellingId(id);
    setActionError("");
    try {
      await cancelServiceRequest(id, token);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setCancellingId(null);
    }
  }

  async function handleComplete(id: string) {
    if (!phoneNumber.trim() || submittingPayment) return;
    setSubmittingPayment(true);
    try {
      if (await runAction((token) => completeServiceRequest(id, phoneNumber.trim(), token))) {
        setPayingId(null);
        setPhoneNumber("");
      }
    } finally {
      setSubmittingPayment(false);
    }
  }

  async function handleFund(id: string) {
    if (!phoneNumber.trim() || submittingPayment) return;
    setSubmittingPayment(true);
    try {
      if (await runAction((token) => fundServiceRequest(id, phoneNumber.trim(), token))) {
        setFundingId(null);
        setPhoneNumber("");
      }
    } finally {
      setSubmittingPayment(false);
    }
  }

  function handleConfirmAndRelease(id: string) {
    if (!window.confirm(t("confirmReleaseQuestion"))) return;
    runAction((token) => completeServiceRequest(id, undefined, token));
  }

  async function handlePhotoUploaded(requestId: string, photoType: "BEFORE" | "AFTER", result: MediaUploadResult) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setActionError("");
    try {
      await uploadServiceRequestPhoto(requestId, photoType, result.url, token);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("actionFailed"));
    }
  }

  if (status === "signedOut") {
    return (
      <main className="max-w-md mx-auto px-4 py-16">
        <div className={`${cardCls} text-center`}>
          <p className="text-slate-600 mb-4 font-semibold text-sm">{t("signInRequired")}</p>
          <Button href="/login">{t("signIn")}</Button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
              <IconWrench size={28} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("title")}</h1>
              <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/technicians" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-white/10 text-white border border-white/15 hover:bg-white/15 transition-colors whitespace-nowrap">{t("findTechnician")}</Link>
            <Link href="/technician-dashboard" className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-400 text-slate-900 hover:bg-amber-300 transition-colors whitespace-nowrap">
              {t("technicianDashboard")} <IconChevronRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      <form onSubmit={handleRequest} className={`${cardCls} mb-6 flex flex-col gap-3`}>
        <h2 className="text-base font-black tracking-tight text-slate-900">{t("requestTaskln")}</h2>
        {chosenTechnician && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-sm">
            <span className="font-semibold text-slate-800">{t("requestingTechnician", { name: chosenTechnician.name })}</span>
            <button type="button" onClick={() => setChosenTechnician(null)} className="text-xs font-bold text-slate-600 underline cursor-pointer">{t("askAllTechnicians")}</button>
          </div>
        )}
        {chosenTechnicianMissing && !chosenTechnician && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">{t("chosenTechnicianUnavailable")}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select aria-label={t("categoryLabel")} value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            {(chosenTechnician ? chosenTechnician.specialties : TASKLN_CATEGORY_CODES).map((value) => <option key={value} value={value}>{labels.category(value)}</option>)}
          </select>
          <select aria-label={t("priorityLabel")} value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
            <option value="SCHEDULED">{t("scheduled")}</option>
            <option value="URGENT">{t("urgent")}</option>
          </select>
        </div>
        <textarea required aria-label={t("descriptionLabel")} rows={3} minLength={10} maxLength={2000} placeholder={t("descriptionPlaceholder")} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        <div className="flex flex-col gap-2">
          {problemPhotos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {problemPhotos.map((url) => (
                <div key={url} className="relative">
                  <img src={url} alt={t("problemPhotos")} className="w-16 h-16 object-cover rounded-xl border border-slate-200" />
                  <button type="button" onClick={() => setProblemPhotos((prev) => prev.filter((u) => u !== url))} aria-label={t("removePhoto")} className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-slate-900 text-white text-xs leading-none cursor-pointer">×</button>
                </div>
              ))}
            </div>
          )}
          {problemPhotos.length < 5 && (
            <MediaUploader folder="services" accept="image/*" label={t("addProblemPhoto")} onUploaded={(result) => setProblemPhotos((prev) => (prev.length < 5 ? [...prev, result.url] : prev))} />
          )}
        </div>
        {priority === "URGENT" ? (
          <p className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">{t("urgentHint")}</p>
        ) : (
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {t("whenNeeded")}
            <input type="datetime-local" min={nowLocalInput()} value={newScheduledFor} onChange={(e) => setNewScheduledFor(e.target.value)} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`} />
          </label>
        )}
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
          {t("addressLabel")}
          <input type="text" maxLength={255} value={addressNote} onChange={(e) => setAddressNote(e.target.value)} placeholder={t("addressPlaceholder")} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`} />
        </label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
          {t("areaLabel")}
          <input type="text" maxLength={100} value={areaLabel} onChange={(e) => setAreaLabel(e.target.value)} placeholder={t("areaPlaceholder")} className={`${inputCls} mt-1.5 normal-case font-normal tracking-normal`} />
        </label>
        <div className="p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-2xl">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block mb-1.5">
            {t("siteLocationLabel")}
          </label>
          <GpsCaptureButton
            onCapture={(coords) => setGpsCoords(coords)}
            currentCoords={gpsCoords}
            label={t("captureSiteGps")}
            hint={t("siteGpsHint")}
            onClear={() => setGpsCoords({ latitude: null, longitude: null })}
            clearLabel={t("remove")}
          />
        </div>
        <Button size="lg" disabled={requesting || !description.trim() || (gpsCoords.latitude === null && !areaLabel.trim())}>{requesting ? t("requesting") : t("requestTaskln")}</Button>
        {gpsCoords.latitude === null && !areaLabel.trim() && <p className="text-xs text-slate-500">{t("captureGpsHint")}</p>}
      </form>

      {notice && <p role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"><IconCheckCircle size={16} className="shrink-0" /> {notice}</p>}
      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <span className="flex items-center gap-2"><IconAlertCircle size={16} className="shrink-0" /> {t("loadFailed")}</span>
          <button type="button" onClick={() => { setListLoading(true); load(); }} className={pillBtnCls}>{t("retry")}</button>
        </div>
      )}

      <div className={`${cardCls} mb-6`}>
        {technicianProfile ? (
          <>
            {technicianProfile.is_verified ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><IconCheckCircle size={18} className="shrink-0" /> {t("registeredTechnician")}: {technicianProfile.specialties.map((s) => labels.category(s)).join(", ")}</p>
            ) : technicianProfile.rejection_reason ? (
              <p className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"><IconAlertCircle size={18} className="mt-0.5 shrink-0" /> {t("technicianRejectedLabel")}: {technicianProfile.rejection_reason}</p>
            ) : (
              <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800"><IconAlertCircle size={18} className="shrink-0" /> {t("technicianPendingVerification")}</p>
            )}
            {technicianProfile.is_verified && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <label className="font-bold text-slate-600" htmlFor="board-radius">{t("boardRadiusLabel")}</label>
                <select id="board-radius" value={boardRadius} onChange={(e) => setBoardRadius(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold">
                  {["10", "30", "100"].map((km) => <option key={km} value={km}>{t("boardRadiusOption", { km })}</option>)}
                  <option value="all">{t("boardRadiusAll")}</option>
                </select>
                <button type="button" onClick={handleShareLocation} disabled={sharingLocation} className={pillBtnCls}>
                  {sharingLocation ? t("sharingLocation") : t("shareMyLocation")}
                </button>
                <span className="text-slate-500">{t("shareLocationHint")}</span>
              </div>
            )}
            <TechnicianDocuments profile={technicianProfile} onSaved={setTechnicianProfile} />
          </>
        ) : showTechnicianForm ? (
          <form onSubmit={handleRegisterTechnician} className="flex flex-col gap-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("selectSpecialties")}</p>
            {registerError && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">{registerError}</p>}
            <div className="flex flex-wrap gap-2">
              {TASKLN_CATEGORY_CODES.map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => toggleSpecialty(value)}
                  aria-pressed={selectedSpecialties.includes(value)}
                  className={`text-xs font-bold px-3.5 py-2 rounded-full border transition-colors cursor-pointer ${selectedSpecialties.includes(value) ? "bg-slate-900 text-amber-300 border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  {labels.category(value)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button disabled={registeringTechnician || selectedSpecialties.length === 0}>{registeringTechnician ? t("requesting") : t("submitRegistration")}</Button>
              <button type="button" onClick={() => setShowTechnicianForm(false)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">{t("cancel")}</button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setShowTechnicianForm(true)}>{t("registerAsTechnician")}</Button>
        )}
      </div>

      {actionError && <p className="mb-4 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"><IconAlertCircle size={16} className="shrink-0" /> {actionError}</p>}
      {receipt && (
        <div className={`${cardCls} mb-4 text-sm`}>
          <div className="flex items-center justify-between mb-2">
            <p className="font-black text-slate-900">{t("receiptTitle", { number: receipt.receipt_number.slice(0, 8).toUpperCase() })}</p>
            <button onClick={() => setReceipt(null)} className={pillBtnCls}>{t("close")}</button>
          </div>
          <p className="text-slate-600">{labels.category(receipt.category_code)}: {receipt.description}</p>
          <p className="text-xs text-slate-500 mb-3">{t("receiptParties", { requester: receipt.requester_name, technician: receipt.technician_name || t("technicianFallback") })}{receipt.completed_at ? ` · ${formatDate(receipt.completed_at)}` : ""}</p>
          {receipt.labor_xaf && <p className="flex justify-between"><span>{t("receiptLabor")}</span><span>{Number(receipt.labor_xaf).toLocaleString()} XAF</span></p>}
          {receipt.materials_xaf && <p className="flex justify-between"><span>{t("receiptMaterials")}</span><span>{Number(receipt.materials_xaf).toLocaleString()} XAF</span></p>}
          <p className="flex justify-between font-black border-t border-slate-100 mt-2 pt-2"><span>{t("receiptTotal")}</span><span>{Number(receipt.total_xaf).toLocaleString()} XAF</span></p>
          {receipt.platform_fee_xaf && <p className="flex justify-between text-xs text-slate-500 mt-1"><span>{t("receiptFee")}</span><span>{Number(receipt.platform_fee_xaf).toLocaleString()} XAF</span></p>}
          {receipt.technician_payout_xaf && <p className="flex justify-between text-xs text-slate-500"><span>{t("receiptPayout")}</span><span>{Number(receipt.technician_payout_xaf).toLocaleString()} XAF</span></p>}
        </div>
      )}
      {(technicianProfile || tab !== "mine") && (
        <div className="flex gap-2 mb-4 overflow-x-auto sm:flex-wrap -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none]" role="tablist">
          {(["mine", "jobs", "board"] as ServiceRequestScope[])
            .filter((value) => value === "mine" || (value === "jobs" && technicianProfile) || (value === "board" && technicianProfile?.is_verified))
            .map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => changeTab(value)}
                className={`shrink-0 whitespace-nowrap text-xs font-bold px-4 py-2.5 sm:py-2 rounded-full border transition-colors cursor-pointer ${tab === value ? "bg-slate-900 text-amber-300 border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                {t(`tab_${value}`)}
              </button>
            ))}
        </div>
      )}
      {status === "loading" || listLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-3xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState icon={<IconWrench size={28} />} title={t(`empty_${tab}`)} />
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((request) => (
            <div key={request.id} className={cardCls}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-base font-black tracking-tight text-slate-900">{labels.category(request.category)}</p>
                <div className="flex gap-2">
                  {request.priority === "URGENT" && <Badge variant="clay">{t("urgent")}</Badge>}
                  <Badge variant={STATUS_VARIANT[request.status] || "neutral"}>{labels.status(request.status)}</Badge>
                </div>
              </div>
              <p className="text-sm text-slate-600 mb-3">{request.description}</p>
              {request.requester !== myUserId && request.requester_rating && (
                <p className="text-xs text-slate-500 mb-3">
                  {request.requester_rating.count > 0 ? t("clientRating", { average: request.requester_rating.average ?? 0, count: request.requester_rating.count }) : t("clientNotRated")}
                </p>
              )}
              {request.status === "REQUESTED" && request.requested_technician && (
                <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">
                  {request.requested_technician === myUserId ? t("requestedYou") : t("requestedFrom", { name: request.requested_technician_name || t("technicianFallback") })}
                </p>
              )}
              {request.area_label && (
                <p className="text-xs text-slate-700 mb-3"><span className="font-semibold">{t("areaShown")}:</span> {request.area_label}</p>
              )}
              {request.address_note && (
                <p className="text-xs text-slate-700 mb-3"><span className="font-semibold">{t("addressShown")}:</span> {request.address_note}</p>
              )}
              {request.scheduled_for && (
                <p className="text-xs text-slate-600 mb-3">{t("scheduledFor", { date: formatDateTime(request.scheduled_for) })}</p>
              )}

              {request.latitude && request.longitude && request.requester !== myUserId && request.technician !== myUserId && (
                <p className="text-xs text-slate-500 mb-3">
                  {request.distance_km != null ? t("distanceAway", { km: request.distance_km }) : t("approximateArea")}
                </p>
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
              {request.quote_deadline && (
                <p className="text-xs text-slate-600 mb-3">{t("quoteDueBy", { date: formatDateTime(request.quote_deadline) })}</p>
              )}
              {request.status === "IN_PROGRESS" && request.work_completed_at && (
                <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg p-2 mb-3">
                  {request.requester === myUserId ? t("workDoneRequester") : t("workDoneTechnician")}
                  {request.auto_release_at ? ` ${t("autoReleaseAt", { date: formatDateTime(request.auto_release_at) })}` : ""}
                </p>
              )}
              {request.status === "DISPUTED" && request.dispute_reason && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2 mb-3">{t("disputedLabel")}: {request.dispute_reason}</p>
              )}
              {request.dispute_resolution && request.status !== "DISPUTED" && (
                <p className="text-xs text-sky-800 bg-sky-50 border border-sky-100 rounded-lg p-2 mb-3">
                  {t("disputeResolvedLabel")}: {t(`disputeResolution_${request.dispute_resolution}`)}
                  {request.dispute_resolution_notes ? ` — ${request.dispute_resolution_notes}` : ""}
                </p>
              )}
              {request.technician_location && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${request.technician_location.latitude},${request.technician_location.longitude}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors mb-3"
                >
                  {t("whereIsTechnician")} ↗
                </a>
              )}

              {(() => {
                const isRequester = request.requester === myUserId;
                const isAssignedTechnician = request.technician === myUserId;
                const active = ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(request.status);
                const linkClass = pillBtnCls;
                return (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {request.status === "REQUESTED" && !isRequester && technicianProfile?.is_verified && (
                        <button onClick={() => handleAccept(request.id)} className={solidBtnCls}>{t("acceptAsTechnician")}</button>
                      )}
                      {request.status === "REQUESTED" && request.requested_technician === myUserId && (
                        <button onClick={() => handleDecline(request.id)} className={pillBtnCls}>{t("declineRequest")}</button>
                      )}
                      {request.status === "REQUESTED" && isRequester && request.requested_technician && (
                        <button onClick={() => handleOpenToAll(request.id)} className={pillBtnCls}>{t("openToAll")}</button>
                      )}
                      {request.status === "REQUESTED" && isRequester && (
                        <button onClick={() => handleCancel(request.id)} disabled={cancellingId === request.id} className={pillBtnCls}>
                          {cancellingId === request.id ? t("cancelling") : t("cancelRequest")}
                        </button>
                      )}
                      {isAssignedTechnician && request.status === "IN_PROGRESS" && !request.work_completed_at && (
                        <button onClick={() => handleWorkDone(request.id)} className={solidBtnCls}>{t("markWorkDone")}</button>
                      )}
                      {isAssignedTechnician && request.status === "ACCEPTED" && (
                        <button onClick={() => handleEnRoute(request.id)} className={solidBtnCls}>{t("onMyWay")}</button>
                      )}
                      {isAssignedTechnician && ["ACCEPTED", "EN_ROUTE"].includes(request.status) && (
                        <>
                          <button onClick={() => handleStart(request.id)} disabled={!request.quote_approved || !request.escrow_funded} title={!request.quote_approved ? t("startWaitingApproval") : !request.escrow_funded ? t("startWaitingFunding") : ""} className={solidBtnCls}>{t("startJob")}</button>
                          <button onClick={() => handleRelease(request.id)} className={pillBtnCls}>{t("releaseJob")}</button>
                        </>
                      )}
                      {isRequester && request.quoted_amount_xaf && !request.quote_approved && active && (
                        <button onClick={() => handleApproveQuote(request.id)} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors cursor-pointer">{t("approveQuote")}</button>
                      )}
                      {isRequester && request.quoted_amount_xaf && !request.escrow_funded && ["ACCEPTED", "EN_ROUTE"].includes(request.status) && (
                        <button onClick={() => handleRejectQuote(request.id)} className={pillBtnCls}>{t("rejectQuote")}</button>
                      )}
                      {isRequester && request.technician && ["ACCEPTED", "EN_ROUTE"].includes(request.status) && (!(request.status === "EN_ROUTE" && request.escrow_funded) || request.technician_overdue) && (
                        <button onClick={() => handleDismissTechnician(request.id)} className={dangerBtnCls}>{t("changeTechnician")}</button>
                      )}
                      {isRequester && request.quote_approved && !request.escrow_funded && active && fundingId !== request.id && (
                        <button onClick={() => setFundingId(request.id)} className={solidBtnCls}>{t("payIntoEscrow")}</button>
                      )}
                      {isRequester && request.status === "IN_PROGRESS" && request.quote_approved && request.escrow_funded && (
                        <button onClick={() => handleConfirmAndRelease(request.id)} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors cursor-pointer">{t("confirmAndRelease")}</button>
                      )}
                      {isRequester && request.status === "IN_PROGRESS" && request.quote_approved && !request.escrow_funded && payingId !== request.id && (
                        <button onClick={() => setPayingId(request.id)} className={solidBtnCls}>{t("completeAndPay")}</button>
                      )}
                      {(isRequester || isAssignedTechnician) && active && disputeId !== request.id && (
                        <button onClick={() => setDisputeId(request.id)} className={dangerBtnCls}>{t("reportProblem")}</button>
                      )}
                    </div>

                    {isAssignedTechnician && active && (
                      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                        <input type="number" min="0" placeholder={request.quoted_amount_xaf ? t("reviseLaborPlaceholder") : t("laborPlaceholder")} value={quoteInputs[request.id] || ""} onChange={(e) => setQuoteInputs((prev) => ({ ...prev, [request.id]: e.target.value }))} className={`${inputCls} flex-1 min-w-28 !w-auto`} />
                        <input type="number" min="0" placeholder={t("materialsPlaceholder")} value={materialsInputs[request.id] || ""} onChange={(e) => setMaterialsInputs((prev) => ({ ...prev, [request.id]: e.target.value }))} className={`${inputCls} flex-1 min-w-28 !w-auto`} />
                        <button onClick={() => handleSendQuote(request.id)} className={solidBtnCls}>{t("sendQuote")}</button>
                      </div>
                    )}

                    {request.escrow_funded && active && (
                      <p className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
                        <IconCheckCircle size={15} className="shrink-0" /> {t("escrowHeld", { amount: Number(request.quoted_amount_xaf).toLocaleString() })}
                      </p>
                    )}

                    {fundingId === request.id && (
                      <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                        <p className="text-xs text-slate-600">{t("payIntoEscrowHint")}</p>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input type="tel" inputMode="tel" autoComplete="tel" aria-label={t("phoneNumberPlaceholder")} placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={`${inputCls} flex-1`} />
                          <button onClick={() => handleFund(request.id)} disabled={!phoneNumber.trim() || submittingPayment} className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50">{t("pay")} {Number(request.quoted_amount_xaf).toLocaleString()} XAF</button>
                          <button onClick={() => setFundingId(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">{t("cancel")}</button>
                        </div>
                      </div>
                    )}

                    {payingId === request.id && (
                      <div className="flex flex-col sm:flex-row gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                        <input type="tel" inputMode="tel" autoComplete="tel" aria-label={t("phoneNumberPlaceholder")} placeholder={t("phoneNumberPlaceholder")} value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={`${inputCls} flex-1`} />
                        <button onClick={() => handleComplete(request.id)} disabled={!phoneNumber.trim() || submittingPayment} className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50">{t("pay")} {Number(request.quoted_amount_xaf).toLocaleString()} XAF</button>
                      </div>
                    )}

                    {disputeId === request.id && (
                      <div className="flex flex-col gap-2 rounded-2xl border border-red-100 bg-red-50/40 p-3">
                        <textarea rows={2} placeholder={t("disputePlaceholder")} value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} className={inputCls} />
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleDispute(request.id)} disabled={disputeReason.trim().length < 5} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer">{t("submitDispute")}</button>
                          <button onClick={() => setDisputeId(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">{t("cancel")}</button>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {(isRequester || isAssignedTechnician) && request.status === "COMPLETED" && (
                        <button onClick={() => handleShowReceipt(request.id)} className={linkClass}>{t("viewReceipt")}</button>
                      )}
                      {request.technician && (isRequester || isAssignedTechnician) && request.status !== "CANCELLED" && (
                        <button onClick={() => setChatId(chatId === request.id ? null : request.id)} className={linkClass}>
                          {chatId === request.id ? t("hideChat") : t("chat")}
                        </button>
                      )}
                      {(isRequester || isAssignedTechnician) && ["REQUESTED", "ACCEPTED", "EN_ROUTE"].includes(request.status) && (isRequester || request.status !== "REQUESTED") && rescheduleId !== request.id && (
                        <button onClick={() => setRescheduleId(request.id)} className={linkClass}>{t("reschedule")}</button>
                      )}
                    </div>

                    {chatId === request.id && request.technician && <ServiceRequestChat requestId={request.id} myUserId={myUserId} />}

                    {rescheduleId === request.id && (
                      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
                        <input type="datetime-local" min={nowLocalInput()} aria-label={t("reschedule")} value={rescheduleValue} onChange={(e) => setRescheduleValue(e.target.value)} className={`${inputCls} flex-1 min-w-44 !w-auto`} />
                        <button
                          disabled={!rescheduleValue}
                          onClick={async () => { await runAction((token) => rescheduleServiceRequest(request.id, new Date(rescheduleValue).toISOString(), token)); setRescheduleId(null); setRescheduleValue(""); }}
                          className={solidBtnCls}
                        >
                          {t("save")}
                        </button>
                        <button onClick={() => setRescheduleId(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">{t("cancel")}</button>
                      </div>
                    )}

                    {(isRequester || isAssignedTechnician) && request.status === "COMPLETED" && request.technician && (
                      <div className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 text-xs text-slate-600">
                        {request.my_review && reviewEditId !== request.id ? (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span><span className="font-semibold">{t("yourReview")}:</span> {request.my_review.score}★{request.my_review.comment ? ` — ${request.my_review.comment}` : ""}</span>
                            <button onClick={() => { setReviewDrafts((prev) => ({ ...prev, [request.id]: { score: request.my_review!.score, comment: request.my_review!.comment } })); setReviewEditId(request.id); }} className={pillBtnCls}>{t("editReview")}</button>
                          </div>
                        ) : (
                          <>
                            <span className="font-semibold">
                              {isRequester ? t("rateTechnician", { name: request.technician_name || t("yourTechnician") }) : t("rateClient", { name: request.requester_name })}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {[1, 2, 3, 4, 5].map((score) => (
                                <button
                                  key={score}
                                  type="button"
                                  onClick={() => setReviewDrafts((prev) => ({ ...prev, [request.id]: { score, comment: prev[request.id]?.comment ?? "" } }))}
                                  aria-pressed={reviewDrafts[request.id]?.score === score}
                                  className={`rounded-lg border px-2.5 py-1 font-bold transition-colors cursor-pointer ${reviewDrafts[request.id]?.score === score ? "bg-amber-400 border-amber-400 text-slate-950" : "border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-300"}`}
                                  aria-label={t("starsLabel", { score })}
                                >{score}★</button>
                              ))}
                            </div>
                            <textarea
                              rows={2}
                              maxLength={1000}
                              placeholder={t("reviewPlaceholder")}
                              value={reviewDrafts[request.id]?.comment ?? ""}
                              onChange={(e) => setReviewDrafts((prev) => ({ ...prev, [request.id]: { score: prev[request.id]?.score ?? 0, comment: e.target.value } }))}
                              className={inputCls}
                            />
                            <div className="flex items-center gap-3">
                              <button onClick={() => handleSubmitReview(request, isRequester)} disabled={!reviewDrafts[request.id]?.score} className={solidBtnCls}>{t("submitReview")}</button>
                              {request.my_review && <button onClick={() => setReviewEditId(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">{t("cancel")}</button>}
                            </div>
                          </>
                        )}
                        {request.their_review ? (
                          <p className="rounded-lg border border-sky-100 bg-sky-50 p-2 text-sky-900">
                            <span className="font-semibold">{t("theirReview")}:</span> {request.their_review.score}★{request.their_review.comment ? ` — ${request.their_review.comment}` : ""}
                          </p>
                        ) : (
                          <p className="text-slate-500">{request.my_review ? t("theirReviewPending") : t("reviewsHiddenHint")}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {["REQUESTED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "DISPUTED"].includes(request.status) &&
                (request.requester === myUserId || request.technician === myUserId) && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{t("jobPhotos")}</p>
                  {request.photos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {request.photos.map((photo) => (
                        <a key={photo.id} href={photo.file_url} target="_blank" rel="noopener noreferrer" className="block">
                          <img src={photo.file_url} alt={photo.photo_type === "BEFORE" ? t("photoBefore") : t("photoAfter")} className="w-16 h-16 object-cover rounded-xl border border-slate-200" />
                          <span className="text-[10px] text-gray-400">{photo.photo_type === "BEFORE" ? t("photoBefore") : t("photoAfter")}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <MediaUploader folder="services" label={t("addBeforePhoto")} onUploaded={(result) => handlePhotoUploaded(request.id, "BEFORE", result)} />
                    {request.status !== "REQUESTED" && (
                      <MediaUploader folder="services" label={t("addAfterPhoto")} onUploaded={(result) => handlePhotoUploaded(request.id, "AFTER", result)} />
                    )}
                  </div>
                </div>
              )}
              {request.status === "REQUESTED" && request.requester !== myUserId && request.photos.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">{t("problemPhotos")}</p>
                  <div className="flex flex-wrap gap-2">
                    {request.photos.map((photo) => (
                      <a key={photo.id} href={photo.file_url} target="_blank" rel="noopener noreferrer" className="block">
                        <img src={photo.file_url} alt={t("problemPhotos")} className="w-16 h-16 object-cover rounded-xl border border-slate-200" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-col items-center gap-2 py-2">
            <p className="text-xs text-slate-500">{t("showingCount", { shown: requests.length, total: totalCount })}</p>
            {hasMore && (
              <button type="button" onClick={handleLoadMore} disabled={loadingMore} className={pillBtnCls}>
                {loadingMore ? t("loadingMore") : t("loadMore")}
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

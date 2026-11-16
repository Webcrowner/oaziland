import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Alert, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { getCurrentCoords } from "../lib/location";
import { usePollWhile } from "../lib/usePollWhile";
import { useI18n, type Translate } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import {
  listMyServiceRequests, createServiceRequest, acceptServiceRequest, getMyTechnicianProfile, startServiceRequest, completeServiceRequest,
  fundServiceRequest, releaseServiceRequest, markServiceRequestEnRoute, proposeServiceQuote, approveServiceQuote, disputeServiceRequest,
  rateServiceTechnician, getMyUserId, getServiceReceipt, listServiceRequestMessages, sendServiceRequestMessage,
  rateServiceRequester, declineServiceRequest, openServiceRequestToAll, rejectServiceQuote, dismissServiceTechnician, markServiceWorkDone,
  cancelServiceRequest, submitTechnicianLocationPing, uploadMediaFile,
  type ServiceRequestItem, type ServiceReceipt, type ServiceRequestMessageItem, type TechnicianProfileItem, type ServiceRequestScope,
} from "../lib/api";

const CATEGORIES = ["PLUMBING", "ELECTRICAL", "PAINTING", "CLEANING", "MOVING", "SECURITY_INSTALLATION"];
const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "#C9A227", ACCEPTED: "#1B2A4A", IN_PROGRESS: "#1B2A4A", COMPLETED: "#16A34A", CANCELLED: "#A8502E", DISPUTED: "#A8502E",
};

/** Private requester/technician chat for one job; refreshes every 10 seconds while open. */
function ServiceChat({ requestId, myUserId }: { requestId: string; myUserId: string | null }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ServiceRequestMessageItem[]>([]);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState("");

  const load = useCallback(() => {
    listServiceRequestMessages(requestId).then(setMessages).catch(() => {});
  }, [requestId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function send() {
    if (!text.trim()) return;
    setSendError("");
    try {
      await sendServiceRequestMessage(requestId, text.trim());
      setText("");
      load();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t("taskln.sendFailed"));
    }
  }

  return (
    <View style={{ marginTop: 6 }}>
      {messages.length === 0 ? <Text style={styles.description}>{t("taskln.noMessages")}</Text> : null}
      {messages.map((m) => (
        <Text key={m.id} style={[styles.description, m.sender === myUserId && { textAlign: "right", fontWeight: "600" }]}>
          {m.sender === myUserId ? "" : `${m.sender_name}: `}{m.text}
        </Text>
      ))}
      <View style={styles.payRow}>
        <TextInput style={styles.payInput} placeholder={t("taskln.typeMessage")} value={text} onChangeText={setText} />
        <TouchableOpacity style={styles.payButton} onPress={send}><Text style={styles.payButtonText}>{t("taskln.send")}</Text></TouchableOpacity>
      </View>
      <Text style={sendError ? styles.sendError : styles.description}>
        {sendError || t("taskln.chatRule")}
      </Text>
    </View>
  );
}

function receiptFor(receipt: ServiceReceipt, item: ServiceRequestItem, t: Translate) {
  if (!receipt.receipt_number || item.status !== "COMPLETED") return null;
  return (
    <View style={{ marginVertical: 6 }}>
      <Text style={styles.category}>{t("taskln.receipt", { number: receipt.receipt_number.slice(0, 8).toUpperCase() })}</Text>
      {receipt.labor_xaf ? <Text style={styles.description}>{t("taskln.labor", { amount: receipt.labor_xaf })}</Text> : null}
      {receipt.materials_xaf ? <Text style={styles.description}>{t("taskln.materials", { amount: receipt.materials_xaf })}</Text> : null}
      <Text style={styles.description}>{t("taskln.total", { amount: receipt.total_xaf ?? "" })}</Text>
    </View>
  );
}

/**
 * Taskln Service — mobile parity with the web app's /taskln-service
 * page, branded per the founder's explicit naming. Real on-demand
 * technician requests, same request -> accept -> start -> complete-
 * and-pay lifecycle as Rides.
 */
export default function TasklnServiceScreen() {
  const { t, locale } = useI18n();
  const [requests, setRequests] = useState<ServiceRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("PLUMBING");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("SCHEDULED");
  const [requesting, setRequesting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [awaitingFundId, setAwaitingFundId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [quoteInputs, setQuoteInputs] = useState<Record<string, string>>({});
  const [materialsInputs, setMaterialsInputs] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<ServiceReceipt | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [technicianProfile, setTechnicianProfile] = useState<TechnicianProfileItem | null>(null);
  const [addressNote, setAddressNote] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [problemPhotos, setProblemPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Each list (my requests / my jobs / job board) is paged separately on the server.
  const [tab, setTab] = useState<ServiceRequestScope>("mine");
  const [boardRadius, setBoardRadius] = useState("30");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { score: number; comment: string }>>({});
  const [reviewEditId, setReviewEditId] = useState<string | null>(null);

  const load = useCallback(() => {
    getMyUserId().then(setMyUserId).catch(() => {});
    getMyTechnicianProfile().then(setTechnicianProfile).catch(() => {});
    listMyServiceRequests({ scope: tab, radiusKm: boardRadius })
      .then((data) => {
        setRequests(data.results);
        setPage(1);
        setHasMore(Boolean(data.next));
        setTotalCount(data.count);
      })
      .catch(() => setRequests([]))
      .finally(() => { setLoading(false); setListLoading(false); });
  }, [tab, boardRadius]);

  useEffect(() => { load(); }, [load]);

  function changeTab(next: ServiceRequestScope) {
    if (next === tab) return;
    setListLoading(true);
    setError("");
    setTab(next);
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const data = await listMyServiceRequests({ scope: tab, radiusKm: boardRadius, page: page + 1 });
      setRequests((prev) => [...prev, ...data.results.filter((item) => !prev.some((p) => p.id === item.id))]);
      setPage(page + 1);
      setHasMore(Boolean(data.next));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("taskln.loadMoreFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleShareLocation() {
    setSharingLocation(true);
    setError("");
    const coords = await getCurrentCoords();
    if (!coords) {
      setError(t("taskln.allowLocationShare"));
      setSharingLocation(false);
      return;
    }
    try {
      await submitTechnicianLocationPing(coords.latitude, coords.longitude);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("taskln.shareFailed"));
    } finally {
      setSharingLocation(false);
    }
  }

  async function handleAddProblemPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    setUploadingPhoto(true);
    try {
      const asset = result.assets[0];
      const uploaded = await uploadMediaFile(asset.uri, asset.mimeType || "image/jpeg", "services");
      setProblemPhotos((prev) => (prev.length < 5 ? [...prev, uploaded.url] : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("taskln.photoFailed"));
    } finally {
      setUploadingPhoto(false);
    }
  }

  // GPS is the best way for technicians to find the site, but naming the town or neighbourhood is enough to post.
  function submitRequest(latitude: number | null, longitude: number | null) {
    return createServiceRequest(category, description, priority, latitude, longitude, { addressNote: addressNote.trim(), areaLabel: areaLabel.trim(), photoUrls: problemPhotos })
      .then(() => {
        setDescription("");
        setAddressNote("");
        setAreaLabel("");
        setProblemPhotos([]);
        if (tab === "mine") load(); else changeTab("mine");
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("taskln.createFailed")))
      .finally(() => setRequesting(false));
  }

  async function handleRequest() {
    setError("");
    setRequesting(true);
    const coords = await getCurrentCoords();
    if (coords) {
      submitRequest(coords.latitude, coords.longitude);
      return;
    }
    if (areaLabel.trim()) {
      submitRequest(null, null);
      return;
    }
    setError(t("taskln.needLocation"));
    setRequesting(false);
  }

  function confirmDismissTechnician(id: string) {
    Alert.alert(
      t("taskln.changeTechTitle"),
      t("taskln.changeTechBody"),
      [{ text: t("taskln.keep"), style: "cancel" }, { text: t("taskln.release"), style: "destructive", onPress: () => runAction(() => dismissServiceTechnician(id)) }],
    );
  }

  async function handleSubmitReview(item: ServiceRequestItem, asRequester: boolean) {
    const draft = reviewDrafts[item.id];
    if (!draft?.score) return;
    const comment = draft.comment.trim();
    await runAction(() => (asRequester ? rateServiceTechnician(item.id, draft.score, comment) : rateServiceRequester(item.id, draft.score, comment)));
    setReviewEditId(null);
  }

  async function runAction(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("taskln.actionFailed"));
    }
  }

  async function handleComplete(id: string) {
    if (!phoneNumber) return;
    await runAction(() => completeServiceRequest(id, phoneNumber));
    setPayingId(null);
    setPhoneNumber("");
  }

  async function handleFund(id: string) {
    if (!phoneNumber) return;
    await runAction(async () => {
      const job = await fundServiceRequest(id, phoneNumber);
      if (!job.escrow_funded) setAwaitingFundId(id);
    });
    setFundingId(null);
    setPhoneNumber("");
  }

  // A payment that lands after the job was cancelled or re-quoted goes back to the wallet; stop waiting and say so.
  const isFundable = (r: ServiceRequestItem) => r.quote_approved && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(r.status);
  const waitingForFunding = awaitingFundId !== null && requests.some((r) => r.id === awaitingFundId && !r.escrow_funded && isFundable(r));
  usePollWhile(waitingForFunding, load, () => {
    setAwaitingFundId(null);
    setError(t("taskln.paymentTimedOut"));
  });

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator color="#1B2A4A" size="large" /></View>;
  }

  return (
    <FlatList
      data={requests}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View>
        {technicianProfile && (
          <View style={[styles.statusBanner, technicianProfile.is_verified ? styles.bannerOk : technicianProfile.rejection_reason ? styles.bannerBad : styles.bannerWait]}>
            <Text style={styles.statusBannerText}>
              {technicianProfile.is_verified
                ? t("taskln.verifiedBanner")
                : technicianProfile.rejection_reason
                  ? t("taskln.rejectedBanner", { reason: technicianProfile.rejection_reason })
                  : t("taskln.waitingBanner")}
            </Text>
          </View>
        )}
        <View style={styles.formCard}>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={[styles.categoryChip, category === c && styles.categoryChipActive]} onPress={() => setCategory(c)}>
                <Text style={[styles.categoryChipText, category === c && styles.categoryChipTextActive]}>{t(`taskln.cat.${c}` as MessageKey)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.priorityToggle} onPress={() => setPriority(priority === "URGENT" ? "SCHEDULED" : "URGENT")}>
            <Text style={styles.priorityToggleText}>{priority === "URGENT" ? t("taskln.urgent") : t("taskln.scheduled")} {t("taskln.tapToChange")}</Text>
          </TouchableOpacity>
          <TextInput style={styles.textArea} placeholder={t("taskln.describe")} value={description} onChangeText={setDescription} multiline numberOfLines={3} />
          {priority === "URGENT" ? (
            <Text style={styles.note}>{t("taskln.urgentNote")}</Text>
          ) : null}
          <TextInput style={styles.payInputFull} placeholder={t("taskln.addressPlaceholder")} value={addressNote} onChangeText={setAddressNote} maxLength={255} />
          <TextInput style={styles.payInputFull} placeholder={t("taskln.areaPlaceholder")} value={areaLabel} onChangeText={setAreaLabel} maxLength={100} />
          {problemPhotos.length > 0 ? (
            <View style={styles.photoRow}>
              {problemPhotos.map((url) => (
                <TouchableOpacity key={url} onPress={() => setProblemPhotos((prev) => prev.filter((u) => u !== url))}>
                  <Image source={{ uri: url }} style={styles.photo} />
                  <Text style={styles.photoRemove}>{t("taskln.remove")}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {problemPhotos.length < 5 ? (
            <TouchableOpacity onPress={handleAddProblemPhoto} disabled={uploadingPhoto} style={{ marginBottom: 10 }}>
              <Text style={styles.actionLink}>{uploadingPhoto ? t("taskln.uploading") : t("taskln.addPhotos")}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.requestButton} onPress={handleRequest} disabled={requesting}>
            {requesting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.requestButtonText}>{t("taskln.request")}</Text>}
          </TouchableOpacity>
          {error ? <Text style={styles.empty}>{error}</Text> : null}
        </View>
        {technicianProfile ? (
          <View style={styles.tabRow}>
            {(["mine", "jobs", "board"] as ServiceRequestScope[])
              .filter((value) => value !== "board" || technicianProfile.is_verified)
              .map((value) => (
                <TouchableOpacity key={value} style={[styles.categoryChip, tab === value && styles.categoryChipActive]} onPress={() => changeTab(value)}>
                  <Text style={[styles.categoryChipText, tab === value && styles.categoryChipTextActive]}>
                    {value === "mine" ? t("taskln.tabMine") : value === "jobs" ? t("taskln.tabJobs") : t("taskln.tabBoard")}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        ) : null}
        {tab === "board" && technicianProfile?.is_verified ? (
          <View style={styles.tabRow}>
            {["10", "30", "100", "all"].map((km) => (
              <TouchableOpacity key={km} style={[styles.categoryChip, boardRadius === km && styles.categoryChipActive]} onPress={() => { setListLoading(true); setBoardRadius(km); }}>
                <Text style={[styles.categoryChipText, boardRadius === km && styles.categoryChipTextActive]}>{km === "all" ? t("taskln.anywhere") : `${km} km`}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={handleShareLocation} disabled={sharingLocation}>
              <Text style={styles.actionLink}>{sharingLocation ? t("taskln.locating") : t("taskln.shareLocation")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        </View>
      }
      ListEmptyComponent={
        listLoading
          ? <ActivityIndicator color="#1B2A4A" style={{ marginTop: 40 }} />
          : <Text style={styles.empty}>{tab === "board" ? t("taskln.emptyBoard") : tab === "jobs" ? t("taskln.emptyJobs") : t("taskln.emptyMine")}</Text>
      }
      ListFooterComponent={
        requests.length > 0 ? (
          <View style={{ alignItems: "center", gap: 8, paddingVertical: 8 }}>
            <Text style={styles.description}>{t("taskln.showing", { shown: requests.length, total: totalCount })}</Text>
            {hasMore ? (
              <TouchableOpacity onPress={handleLoadMore} disabled={loadingMore}>
                <Text style={styles.actionLink}>{loadingMore ? t("taskln.loading") : t("taskln.loadMore")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.category}>{t(`taskln.cat.${item.category}` as MessageKey)}</Text>
            <View style={styles.badgeGroup}>
              {item.priority === "URGENT" && <View style={styles.urgentBadge}><Text style={styles.urgentBadgeText}>{t("taskln.urgentBadge")}</Text></View>}
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || "#9CA3AF" }]}>
                <Text style={styles.statusBadgeText}>{t(`taskln.status.${item.status}` as MessageKey)}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.description}>{item.description}</Text>

          {item.status === "REQUESTED" && item.requested_technician ? (
            <Text style={styles.note}>
              {item.requested_technician === myUserId ? t("taskln.chosenYou") : t("taskln.waitingFor", { name: item.requested_technician_name || t("taskln.theTechnician") })}
            </Text>
          ) : null}
          {item.requester !== myUserId && item.requester_rating ? (
            <Text style={styles.description}>
              {item.requester_rating.count > 0 ? t("taskln.clientRating", { average: item.requester_rating.average ?? "", count: item.requester_rating.count }) : t("taskln.clientNotRated")}
            </Text>
          ) : null}
          {item.area_label ? <Text style={styles.description}>{t("taskln.area", { value: item.area_label })}</Text> : null}
          {item.address_note ? <Text style={styles.description}>{t("taskln.address", { value: item.address_note })}</Text> : null}
          {item.distance_km != null ? <Text style={styles.description}>{t("taskln.distance", { km: item.distance_km })}</Text> : null}
          {item.quote_deadline ? <Text style={styles.description}>{t("taskln.quoteDeadline", { date: new Date(item.quote_deadline).toLocaleString(locale) })}</Text> : null}
          {item.status === "IN_PROGRESS" && item.work_completed_at ? (
            <Text style={styles.note}>
              {item.requester === myUserId
                ? t("taskln.workDoneRequester")
                : t("taskln.workDoneTechnician")}
              {item.auto_release_at ? ` ${t("taskln.autoRelease", { date: new Date(item.auto_release_at).toLocaleString(locale) })}` : ""}
            </Text>
          ) : null}
          {item.photos && item.photos.length > 0 && item.status !== "COMPLETED" ? (
            <View style={styles.photoRow}>
              {item.photos.map((photo) => <Image key={photo.id} source={{ uri: photo.file_url }} style={styles.photo} />)}
            </View>
          ) : null}

          {item.status === "REQUESTED" && item.requested_technician === myUserId ? (
            <TouchableOpacity onPress={() => runAction(() => declineServiceRequest(item.id))}><Text style={styles.actionLink}>{t("taskln.decline")}</Text></TouchableOpacity>
          ) : null}
          {item.status === "REQUESTED" && item.requester === myUserId && item.requested_technician ? (
            <TouchableOpacity onPress={() => runAction(() => openServiceRequestToAll(item.id))}><Text style={styles.actionLink}>{t("taskln.openToAll")}</Text></TouchableOpacity>
          ) : null}
          {item.status === "REQUESTED" && item.requester === myUserId ? (
            <TouchableOpacity onPress={() => runAction(() => cancelServiceRequest(item.id))}><Text style={styles.actionLink}>{t("taskln.cancelRequest")}</Text></TouchableOpacity>
          ) : null}
          {item.quoted_amount_xaf && (
            <Text style={styles.description}>{t("taskln.quote", { amount: item.quoted_amount_xaf ?? "" })} {item.quote_approved ? t("taskln.approved") : t("taskln.awaitingApproval")}</Text>
          )}

          {item.status === "REQUESTED" && item.requester !== myUserId && technicianProfile?.is_verified && (
            <TouchableOpacity onPress={() => runAction(() => acceptServiceRequest(item.id))}><Text style={styles.actionLink}>{t("taskln.accept")}</Text></TouchableOpacity>
          )}
          {item.technician === myUserId && item.status === "ACCEPTED" && (
            <TouchableOpacity onPress={() => runAction(() => markServiceRequestEnRoute(item.id))}><Text style={styles.actionLink}>{t("taskln.onMyWay")}</Text></TouchableOpacity>
          )}
          {item.technician === myUserId && (item.status === "ACCEPTED" || item.status === "EN_ROUTE") && (
            <>
              <TouchableOpacity onPress={() => runAction(() => startServiceRequest(item.id))} disabled={!item.quote_approved || !item.escrow_funded}>
                <Text style={[styles.actionLink, (!item.quote_approved || !item.escrow_funded) && { opacity: 0.4 }]}>{t("taskln.startJob")}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => runAction(() => releaseServiceRequest(item.id))}><Text style={styles.actionLink}>{t("taskln.releaseJob")}</Text></TouchableOpacity>
            </>
          )}
          {item.technician === myUserId && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder={t("taskln.laborPlaceholder")} value={quoteInputs[item.id] || ""} onChangeText={(v) => setQuoteInputs((prev) => ({ ...prev, [item.id]: v }))} keyboardType="numeric" />
              <TextInput style={styles.payInput} placeholder={t("taskln.materialsPlaceholder")} value={materialsInputs[item.id] || ""} onChangeText={(v) => setMaterialsInputs((prev) => ({ ...prev, [item.id]: v }))} keyboardType="numeric" />
              <TouchableOpacity style={styles.payButton} onPress={() => runAction(() => proposeServiceQuote(item.id, quoteInputs[item.id] || "", materialsInputs[item.id]))}>
                <Text style={styles.payButtonText}>{t("taskln.sendQuote")}</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.requester === myUserId && item.quoted_amount_xaf && !item.quote_approved && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <TouchableOpacity onPress={() => runAction(() => approveServiceQuote(item.id))}><Text style={styles.actionLink}>{t("taskln.approveQuote")}</Text></TouchableOpacity>
          )}
          {item.requester === myUserId && item.quote_approved && !item.escrow_funded && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && fundingId !== item.id && awaitingFundId !== item.id && (
            <TouchableOpacity onPress={() => setFundingId(item.id)}><Text style={styles.actionLink}>{t("taskln.payEscrow")}</Text></TouchableOpacity>
          )}
          {awaitingFundId === item.id && !item.escrow_funded && isFundable(item) && (
            <Text style={styles.description}>{t("taskln.approveOnPhone", { amount: item.quoted_amount_xaf ?? "" })}</Text>
          )}
          {awaitingFundId === item.id && !item.escrow_funded && !isFundable(item) && (
            <Text style={styles.description}>{t("taskln.paymentRefunded")}</Text>
          )}
          {fundingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder={t("taskln.phone")} value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleFund(item.id)}>
                <Text style={styles.payButtonText}>{t("taskln.pay", { amount: item.quoted_amount_xaf ?? "" })}</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.escrow_funded && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <Text style={styles.description}>{t("taskln.heldInEscrow", { amount: item.quoted_amount_xaf ?? "" })}</Text>
          )}
          {item.requester === myUserId && item.status === "IN_PROGRESS" && item.quote_approved && item.escrow_funded && (
            <TouchableOpacity onPress={() => runAction(() => completeServiceRequest(item.id))}><Text style={styles.actionLink}>{t("taskln.confirmRelease")}</Text></TouchableOpacity>
          )}
          {item.requester === myUserId && item.status === "IN_PROGRESS" && item.quote_approved && !item.escrow_funded && payingId !== item.id && (
            <TouchableOpacity onPress={() => setPayingId(item.id)}><Text style={styles.actionLink}>{t("taskln.completePay")}</Text></TouchableOpacity>
          )}
          {payingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder={t("taskln.phone")} value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleComplete(item.id)}>
                <Text style={styles.payButtonText}>{t("taskln.pay", { amount: item.quoted_amount_xaf ?? "" })}</Text>
              </TouchableOpacity>
            </View>
          )}

          {item.technician === myUserId && item.status === "IN_PROGRESS" && !item.work_completed_at ? (
            <TouchableOpacity onPress={() => runAction(() => markServiceWorkDone(item.id))}><Text style={styles.actionLink}>{t("taskln.markDone")}</Text></TouchableOpacity>
          ) : null}
          {item.requester === myUserId && item.quoted_amount_xaf && !item.escrow_funded && ["ACCEPTED", "EN_ROUTE"].includes(item.status) ? (
            <TouchableOpacity onPress={() => runAction(() => rejectServiceQuote(item.id))}><Text style={styles.actionLink}>{t("taskln.rejectQuote")}</Text></TouchableOpacity>
          ) : null}
          {item.requester === myUserId && item.technician && ["ACCEPTED", "EN_ROUTE"].includes(item.status) && (!(item.status === "EN_ROUTE" && item.escrow_funded) || item.technician_overdue) ? (
            <TouchableOpacity onPress={() => confirmDismissTechnician(item.id)}><Text style={styles.actionLink}>{t("taskln.changeTech")}</Text></TouchableOpacity>
          ) : null}
          {item.status === "DISPUTED" && item.dispute_reason ? <Text style={styles.description}>{t("taskln.disputed", { reason: item.dispute_reason })}</Text> : null}
          {item.dispute_resolution && item.status !== "DISPUTED" ? (
            <Text style={styles.description}>
              {t("taskln.supportDecision", { outcome: t(`taskln.dispute.${item.dispute_resolution}` as MessageKey) })}{item.dispute_resolution_notes ? ` — ${item.dispute_resolution_notes}` : ""}
            </Text>
          ) : null}
          {(item.requester === myUserId || item.technician === myUserId) && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && disputeId !== item.id && (
            <TouchableOpacity onPress={() => setDisputeId(item.id)}><Text style={styles.actionLink}>{t("taskln.reportProblem")}</Text></TouchableOpacity>
          )}
          {disputeId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder={t("taskln.whatWrong")} value={disputeReason} onChangeText={setDisputeReason} />
              <TouchableOpacity
                style={styles.payButton} disabled={disputeReason.trim().length < 5}
                onPress={async () => { await runAction(() => disputeServiceRequest(item.id, disputeReason)); setDisputeId(null); setDisputeReason(""); }}
              >
                <Text style={styles.payButtonText}>{t("taskln.submit")}</Text>
              </TouchableOpacity>
            </View>
          )}
          {(item.requester === myUserId || item.technician === myUserId) && item.status === "COMPLETED" && item.technician ? (
            <View style={styles.reviewBox}>
              {item.my_review && reviewEditId !== item.id ? (
                <>
                  <Text style={styles.description}>{t("taskln.yourReview", { score: item.my_review.score })}{item.my_review.comment ? ` — ${item.my_review.comment}` : ""}</Text>
                  <TouchableOpacity onPress={() => { setReviewDrafts((prev) => ({ ...prev, [item.id]: { score: item.my_review!.score, comment: item.my_review!.comment } })); setReviewEditId(item.id); }}>
                    <Text style={styles.actionLink}>{t("taskln.editReview")}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.description}>{item.requester === myUserId ? t("taskln.rate", { name: item.technician_name || t("taskln.yourTechnician") }) : t("taskln.rate", { name: item.requester_name })}</Text>
                  <View style={styles.payRow}>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <TouchableOpacity key={score} onPress={() => setReviewDrafts((prev) => ({ ...prev, [item.id]: { score, comment: prev[item.id]?.comment ?? "" } }))}>
                        <Text style={[styles.actionLink, reviewDrafts[item.id]?.score === score && { color: "#C9A227" }]}>{score}★</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.payInputFull} placeholder={t("taskln.reviewPlaceholder")} maxLength={1000} multiline
                    value={reviewDrafts[item.id]?.comment ?? ""}
                    onChangeText={(v) => setReviewDrafts((prev) => ({ ...prev, [item.id]: { score: prev[item.id]?.score ?? 0, comment: v } }))}
                  />
                  <TouchableOpacity onPress={() => handleSubmitReview(item, item.requester === myUserId)} disabled={!reviewDrafts[item.id]?.score}>
                    <Text style={[styles.actionLink, !reviewDrafts[item.id]?.score && { opacity: 0.4 }]}>{t("taskln.submitReview")}</Text>
                  </TouchableOpacity>
                </>
              )}
              {item.their_review
                ? <Text style={styles.description}>{t("taskln.theirReview", { score: item.their_review.score })}{item.their_review.comment ? ` — ${item.their_review.comment}` : ""}</Text>
                : <Text style={styles.description}>{item.my_review ? t("taskln.otherNotReviewed") : t("taskln.reviewsHidden")}</Text>}
            </View>
          ) : null}

          {item.scheduled_for ? <Text style={styles.description}>{t("taskln.scheduledFor", { date: new Date(item.scheduled_for).toLocaleString(locale) })}</Text> : null}
          {(item.requester === myUserId || item.technician === myUserId) && item.status === "COMPLETED" && (
            <TouchableOpacity onPress={() => runAction(async () => { setReceipt(await getServiceReceipt(item.id)); setReceiptId(item.id); })}><Text style={styles.actionLink}>{t("taskln.viewReceipt")}</Text></TouchableOpacity>
          )}
          {receipt && receiptId === item.id && receiptFor(receipt, item, t)}
          {item.technician && (item.requester === myUserId || item.technician === myUserId) && item.status !== "CANCELLED" && (
            <>
              <TouchableOpacity onPress={() => setChatId(chatId === item.id ? null : item.id)}><Text style={styles.actionLink}>{chatId === item.id ? t("taskln.hideChat") : t("taskln.chat")}</Text></TouchableOpacity>
              {chatId === item.id && <ServiceChat requestId={item.id} myUserId={myUserId} />}
            </>
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", color: "#6B7280", marginTop: 40 },
  formCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 16, marginBottom: 16 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  categoryChip: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  categoryChipActive: { backgroundColor: "#1B2A4A", borderColor: "#1B2A4A" },
  categoryChipText: { fontSize: 11, color: "#374151" },
  categoryChipTextActive: { color: "#fff", fontWeight: "700" },
  priorityToggle: { marginBottom: 10 },
  priorityToggleText: { fontSize: 12, color: "#6B7280" },
  textArea: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14, textAlignVertical: "top" },
  requestButton: { backgroundColor: "#C9A227", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  requestButtonText: { color: "#1B2A4A", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  category: { fontSize: 13, fontWeight: "700", color: "#1B2A4A" },
  badgeGroup: { flexDirection: "row", gap: 6 },
  urgentBadge: { backgroundColor: "#A8502E", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  urgentBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  description: { fontSize: 13, color: "#374151", marginBottom: 8 },
  statusBanner: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
  statusBannerText: { fontSize: 13, color: "#1F2937" },
  bannerOk: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  bannerWait: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  bannerBad: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  actionLink: { fontSize: 13, color: "#1B2A4A", fontWeight: "700", textDecorationLine: "underline" },
  payRow: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  payInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 6, padding: 8, fontSize: 13, minWidth: 100 },
  payButton: { backgroundColor: "#C9A227", borderRadius: 6, paddingHorizontal: 16, justifyContent: "center" },
  payButtonText: { color: "#1B2A4A", fontWeight: "700", fontSize: 13 },
  note: { fontSize: 12, color: "#92400E", backgroundColor: "#FFFBEB", borderRadius: 6, padding: 8, marginBottom: 8 },
  payInputFull: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12, alignItems: "center" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  photo: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderColor: "#E5E7EB" },
  photoRemove: { fontSize: 10, color: "#6B7280", textAlign: "center" },
  reviewBox: { backgroundColor: "#F9FAFB", borderRadius: 8, padding: 10, marginTop: 6, gap: 6 },
  sendError: { fontSize: 13, color: "#B91C1C", marginTop: 4, marginBottom: 8 },
});

import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Alert, Image } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { getCurrentCoords } from "../lib/location";
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
const DISPUTE_OUTCOMES: Record<string, string> = {
  RESUME: "The job continues.",
  REASSIGN: "The job went back on the job board.",
  CANCEL: "The job was cancelled.",
};

/** Private requester/technician chat for one job; refreshes every 10 seconds while open. */
function ServiceChat({ requestId, myUserId }: { requestId: string; myUserId: string | null }) {
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
      setSendError(err instanceof Error ? err.message : "Could not send the message");
    }
  }

  return (
    <View style={{ marginTop: 6 }}>
      {messages.length === 0 ? <Text style={styles.description}>No messages yet.</Text> : null}
      {messages.map((m) => (
        <Text key={m.id} style={[styles.description, m.sender === myUserId && { textAlign: "right", fontWeight: "600" }]}>
          {m.sender === myUserId ? "" : `${m.sender_name}: `}{m.text}
        </Text>
      ))}
      <View style={styles.payRow}>
        <TextInput style={styles.payInput} placeholder="Type a message" value={text} onChangeText={setText} />
        <TouchableOpacity style={styles.payButton} onPress={send}><Text style={styles.payButtonText}>Send</Text></TouchableOpacity>
      </View>
      <Text style={sendError ? styles.sendError : styles.description}>
        {sendError || "Phone numbers, emails and chat links can be shared once the job is completed."}
      </Text>
    </View>
  );
}

function receiptFor(receipt: ServiceReceipt, item: ServiceRequestItem) {
  if (!receipt.receipt_number || item.status !== "COMPLETED") return null;
  return (
    <View style={{ marginVertical: 6 }}>
      <Text style={styles.category}>Receipt #{receipt.receipt_number.slice(0, 8).toUpperCase()}</Text>
      {receipt.labor_xaf ? <Text style={styles.description}>Labor: {receipt.labor_xaf} XAF</Text> : null}
      {receipt.materials_xaf ? <Text style={styles.description}>Materials: {receipt.materials_xaf} XAF</Text> : null}
      <Text style={styles.description}>Total: {receipt.total_xaf} XAF</Text>
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
  const [requests, setRequests] = useState<ServiceRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("PLUMBING");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("SCHEDULED");
  const [requesting, setRequesting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [fundingId, setFundingId] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : "Could not load more");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleShareLocation() {
    setSharingLocation(true);
    setError("");
    const coords = await getCurrentCoords();
    if (!coords) {
      setError("Allow location access to share your location.");
      setSharingLocation(false);
      return;
    }
    try {
      await submitTechnicianLocationPing(coords.latitude, coords.longitude);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not share your location");
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
      setError(err instanceof Error ? err.message : "Could not upload the photo");
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
      .catch((err) => setError(err instanceof Error ? err.message : "Could not create the request"))
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
    setError("Allow location access, or enter the town or neighbourhood, so technicians can tell where the job is.");
    setRequesting(false);
  }

  function confirmDismissTechnician(id: string) {
    Alert.alert(
      "Change technician?",
      "Release this technician and put the job back on the board? Any payment held for it will be refunded.",
      [{ text: "Keep", style: "cancel" }, { text: "Release", style: "destructive", onPress: () => runAction(() => dismissServiceTechnician(id)) }],
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
      setError(err instanceof Error ? err.message : "Action failed");
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
    await runAction(() => fundServiceRequest(id, phoneNumber));
    setFundingId(null);
    setPhoneNumber("");
  }

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
                ? "✓ Verified technician — you can accept jobs."
                : technicianProfile.rejection_reason
                  ? `Your technician application was not approved: ${technicianProfile.rejection_reason}`
                  : "Your technician registration is waiting for admin verification."}
            </Text>
          </View>
        )}
        <View style={styles.formCard}>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} style={[styles.categoryChip, category === c && styles.categoryChipActive]} onPress={() => setCategory(c)}>
                <Text style={[styles.categoryChipText, category === c && styles.categoryChipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.priorityToggle} onPress={() => setPriority(priority === "URGENT" ? "SCHEDULED" : "URGENT")}>
            <Text style={styles.priorityToggleText}>{priority === "URGENT" ? "⚡ Urgent" : "📅 Scheduled"} (tap to change)</Text>
          </TouchableOpacity>
          <TextInput style={styles.textArea} placeholder="Describe what you need done..." value={description} onChangeText={setDescription} multiline numberOfLines={3} />
          {priority === "URGENT" ? (
            <Text style={styles.note}>Urgent requests alert more technicians at once, show first on the job board, and the technician must quote within 2 hours.</Text>
          ) : null}
          <TextInput style={styles.payInputFull} placeholder="Address or landmark (only your technician sees it)" value={addressNote} onChangeText={setAddressNote} maxLength={255} />
          <TextInput style={styles.payInputFull} placeholder="Town or neighbourhood (needed if location is off)" value={areaLabel} onChangeText={setAreaLabel} maxLength={100} />
          {problemPhotos.length > 0 ? (
            <View style={styles.photoRow}>
              {problemPhotos.map((url) => (
                <TouchableOpacity key={url} onPress={() => setProblemPhotos((prev) => prev.filter((u) => u !== url))}>
                  <Image source={{ uri: url }} style={styles.photo} />
                  <Text style={styles.photoRemove}>Remove</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {problemPhotos.length < 5 ? (
            <TouchableOpacity onPress={handleAddProblemPhoto} disabled={uploadingPhoto} style={{ marginBottom: 10 }}>
              <Text style={styles.actionLink}>{uploadingPhoto ? "Uploading..." : "Add photos of the problem (up to 5)"}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.requestButton} onPress={handleRequest} disabled={requesting}>
            {requesting ? <ActivityIndicator color="#1B2A4A" /> : <Text style={styles.requestButtonText}>Request Taskln Service</Text>}
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
                    {value === "mine" ? "My requests" : value === "jobs" ? "My jobs" : "Job board"}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        ) : null}
        {tab === "board" && technicianProfile?.is_verified ? (
          <View style={styles.tabRow}>
            {["10", "30", "100", "all"].map((km) => (
              <TouchableOpacity key={km} style={[styles.categoryChip, boardRadius === km && styles.categoryChipActive]} onPress={() => { setListLoading(true); setBoardRadius(km); }}>
                <Text style={[styles.categoryChipText, boardRadius === km && styles.categoryChipTextActive]}>{km === "all" ? "Anywhere" : `${km} km`}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={handleShareLocation} disabled={sharingLocation}>
              <Text style={styles.actionLink}>{sharingLocation ? "Locating..." : "Share my location"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        </View>
      }
      ListEmptyComponent={
        listLoading
          ? <ActivityIndicator color="#1B2A4A" style={{ marginTop: 40 }} />
          : <Text style={styles.empty}>{tab === "board" ? "No open jobs match your specialties near you right now." : tab === "jobs" ? "No jobs assigned to you yet." : "No requests yet."}</Text>
      }
      ListFooterComponent={
        requests.length > 0 ? (
          <View style={{ alignItems: "center", gap: 8, paddingVertical: 8 }}>
            <Text style={styles.description}>Showing {requests.length} of {totalCount}</Text>
            {hasMore ? (
              <TouchableOpacity onPress={handleLoadMore} disabled={loadingMore}>
                <Text style={styles.actionLink}>{loadingMore ? "Loading..." : "Load more"}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.category}>{item.category}</Text>
            <View style={styles.badgeGroup}>
              {item.priority === "URGENT" && <View style={styles.urgentBadge}><Text style={styles.urgentBadgeText}>URGENT</Text></View>}
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] || "#9CA3AF" }]}>
                <Text style={styles.statusBadgeText}>{item.status.replace("_", " ")}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.description}>{item.description}</Text>

          {item.status === "REQUESTED" && item.requested_technician ? (
            <Text style={styles.note}>
              {item.requested_technician === myUserId ? "The requester chose you for this job." : `Waiting for ${item.requested_technician_name || "the technician"} to respond.`}
            </Text>
          ) : null}
          {item.requester !== myUserId && item.requester_rating ? (
            <Text style={styles.description}>
              {item.requester_rating.count > 0 ? `Client rating: ${item.requester_rating.average} ★ (${item.requester_rating.count})` : "Client not rated yet"}
            </Text>
          ) : null}
          {item.area_label ? <Text style={styles.description}>Area: {item.area_label}</Text> : null}
          {item.address_note ? <Text style={styles.description}>Address: {item.address_note}</Text> : null}
          {item.distance_km != null ? <Text style={styles.description}>About {item.distance_km} km from your last shared location.</Text> : null}
          {item.quote_deadline ? <Text style={styles.description}>The technician must send a quote by {new Date(item.quote_deadline).toLocaleString()}, or the job returns to the job board.</Text> : null}
          {item.status === "IN_PROGRESS" && item.work_completed_at ? (
            <Text style={styles.note}>
              {item.requester === myUserId
                ? "Your technician says the job is finished. Confirm it to release the payment, or report a problem."
                : "You reported the work as done. Waiting for the requester to confirm."}
              {item.auto_release_at ? ` Payment is released automatically on ${new Date(item.auto_release_at).toLocaleString()} unless a problem is reported.` : ""}
            </Text>
          ) : null}
          {item.photos && item.photos.length > 0 && item.status !== "COMPLETED" ? (
            <View style={styles.photoRow}>
              {item.photos.map((photo) => <Image key={photo.id} source={{ uri: photo.file_url }} style={styles.photo} />)}
            </View>
          ) : null}

          {item.status === "REQUESTED" && item.requested_technician === myUserId ? (
            <TouchableOpacity onPress={() => runAction(() => declineServiceRequest(item.id))}><Text style={styles.actionLink}>Decline</Text></TouchableOpacity>
          ) : null}
          {item.status === "REQUESTED" && item.requester === myUserId && item.requested_technician ? (
            <TouchableOpacity onPress={() => runAction(() => openServiceRequestToAll(item.id))}><Text style={styles.actionLink}>Open to all technicians</Text></TouchableOpacity>
          ) : null}
          {item.status === "REQUESTED" && item.requester === myUserId ? (
            <TouchableOpacity onPress={() => runAction(() => cancelServiceRequest(item.id))}><Text style={styles.actionLink}>Cancel request</Text></TouchableOpacity>
          ) : null}
          {item.quoted_amount_xaf && (
            <Text style={styles.description}>Quote: {item.quoted_amount_xaf} XAF {item.quote_approved ? "(approved)" : "(awaiting approval)"}</Text>
          )}

          {item.status === "REQUESTED" && item.requester !== myUserId && technicianProfile?.is_verified && (
            <TouchableOpacity onPress={() => runAction(() => acceptServiceRequest(item.id))}><Text style={styles.actionLink}>Accept as Technician</Text></TouchableOpacity>
          )}
          {item.technician === myUserId && item.status === "ACCEPTED" && (
            <TouchableOpacity onPress={() => runAction(() => markServiceRequestEnRoute(item.id))}><Text style={styles.actionLink}>I&apos;m on my way</Text></TouchableOpacity>
          )}
          {item.technician === myUserId && (item.status === "ACCEPTED" || item.status === "EN_ROUTE") && (
            <>
              <TouchableOpacity onPress={() => runAction(() => startServiceRequest(item.id))} disabled={!item.quote_approved || !item.escrow_funded}>
                <Text style={[styles.actionLink, (!item.quote_approved || !item.escrow_funded) && { opacity: 0.4 }]}>Start Job</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => runAction(() => releaseServiceRequest(item.id))}><Text style={styles.actionLink}>Release job</Text></TouchableOpacity>
            </>
          )}
          {item.technician === myUserId && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="Labor (XAF)" value={quoteInputs[item.id] || ""} onChangeText={(v) => setQuoteInputs((prev) => ({ ...prev, [item.id]: v }))} keyboardType="numeric" />
              <TextInput style={styles.payInput} placeholder="Materials (XAF)" value={materialsInputs[item.id] || ""} onChangeText={(v) => setMaterialsInputs((prev) => ({ ...prev, [item.id]: v }))} keyboardType="numeric" />
              <TouchableOpacity style={styles.payButton} onPress={() => runAction(() => proposeServiceQuote(item.id, quoteInputs[item.id] || "", materialsInputs[item.id]))}>
                <Text style={styles.payButtonText}>Send quote</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.requester === myUserId && item.quoted_amount_xaf && !item.quote_approved && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <TouchableOpacity onPress={() => runAction(() => approveServiceQuote(item.id))}><Text style={styles.actionLink}>Approve quote</Text></TouchableOpacity>
          )}
          {item.requester === myUserId && item.quote_approved && !item.escrow_funded && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && fundingId !== item.id && (
            <TouchableOpacity onPress={() => setFundingId(item.id)}><Text style={styles.actionLink}>Pay into escrow</Text></TouchableOpacity>
          )}
          {fundingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleFund(item.id)}>
                <Text style={styles.payButtonText}>Pay {item.quoted_amount_xaf} XAF</Text>
              </TouchableOpacity>
            </View>
          )}
          {item.escrow_funded && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && (
            <Text style={styles.description}>Payment of {item.quoted_amount_xaf} XAF is held in escrow.</Text>
          )}
          {item.requester === myUserId && item.status === "IN_PROGRESS" && item.quote_approved && item.escrow_funded && (
            <TouchableOpacity onPress={() => runAction(() => completeServiceRequest(item.id))}><Text style={styles.actionLink}>Confirm done & release payment</Text></TouchableOpacity>
          )}
          {item.requester === myUserId && item.status === "IN_PROGRESS" && item.quote_approved && !item.escrow_funded && payingId !== item.id && (
            <TouchableOpacity onPress={() => setPayingId(item.id)}><Text style={styles.actionLink}>Complete & Pay</Text></TouchableOpacity>
          )}
          {payingId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} />
              <TouchableOpacity style={styles.payButton} onPress={() => handleComplete(item.id)}>
                <Text style={styles.payButtonText}>Pay {item.quoted_amount_xaf} XAF</Text>
              </TouchableOpacity>
            </View>
          )}

          {item.technician === myUserId && item.status === "IN_PROGRESS" && !item.work_completed_at ? (
            <TouchableOpacity onPress={() => runAction(() => markServiceWorkDone(item.id))}><Text style={styles.actionLink}>Mark work as done</Text></TouchableOpacity>
          ) : null}
          {item.requester === myUserId && item.quoted_amount_xaf && !item.escrow_funded && ["ACCEPTED", "EN_ROUTE"].includes(item.status) ? (
            <TouchableOpacity onPress={() => runAction(() => rejectServiceQuote(item.id))}><Text style={styles.actionLink}>Reject quote</Text></TouchableOpacity>
          ) : null}
          {item.requester === myUserId && item.technician && ["ACCEPTED", "EN_ROUTE"].includes(item.status) && (!(item.status === "EN_ROUTE" && item.escrow_funded) || item.technician_overdue) ? (
            <TouchableOpacity onPress={() => confirmDismissTechnician(item.id)}><Text style={styles.actionLink}>Change technician</Text></TouchableOpacity>
          ) : null}
          {item.status === "DISPUTED" && item.dispute_reason ? <Text style={styles.description}>Disputed: {item.dispute_reason}</Text> : null}
          {item.dispute_resolution && item.status !== "DISPUTED" ? (
            <Text style={styles.description}>
              Support decision: {DISPUTE_OUTCOMES[item.dispute_resolution]}{item.dispute_resolution_notes ? ` — ${item.dispute_resolution_notes}` : ""}
            </Text>
          ) : null}
          {(item.requester === myUserId || item.technician === myUserId) && ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(item.status) && disputeId !== item.id && (
            <TouchableOpacity onPress={() => setDisputeId(item.id)}><Text style={styles.actionLink}>Report a problem</Text></TouchableOpacity>
          )}
          {disputeId === item.id && (
            <View style={styles.payRow}>
              <TextInput style={styles.payInput} placeholder="What went wrong?" value={disputeReason} onChangeText={setDisputeReason} />
              <TouchableOpacity
                style={styles.payButton} disabled={disputeReason.trim().length < 5}
                onPress={async () => { await runAction(() => disputeServiceRequest(item.id, disputeReason)); setDisputeId(null); setDisputeReason(""); }}
              >
                <Text style={styles.payButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          )}
          {(item.requester === myUserId || item.technician === myUserId) && item.status === "COMPLETED" && item.technician ? (
            <View style={styles.reviewBox}>
              {item.my_review && reviewEditId !== item.id ? (
                <>
                  <Text style={styles.description}>Your review: {item.my_review.score}★{item.my_review.comment ? ` — ${item.my_review.comment}` : ""}</Text>
                  <TouchableOpacity onPress={() => { setReviewDrafts((prev) => ({ ...prev, [item.id]: { score: item.my_review!.score, comment: item.my_review!.comment } })); setReviewEditId(item.id); }}>
                    <Text style={styles.actionLink}>Edit review</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.description}>{item.requester === myUserId ? `Rate ${item.technician_name || "your technician"}:` : `Rate ${item.requester_name}:`}</Text>
                  <View style={styles.payRow}>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <TouchableOpacity key={score} onPress={() => setReviewDrafts((prev) => ({ ...prev, [item.id]: { score, comment: prev[item.id]?.comment ?? "" } }))}>
                        <Text style={[styles.actionLink, reviewDrafts[item.id]?.score === score && { color: "#C9A227" }]}>{score}★</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    style={styles.payInputFull} placeholder="Write a short review (optional)" maxLength={1000} multiline
                    value={reviewDrafts[item.id]?.comment ?? ""}
                    onChangeText={(v) => setReviewDrafts((prev) => ({ ...prev, [item.id]: { score: prev[item.id]?.score ?? 0, comment: v } }))}
                  />
                  <TouchableOpacity onPress={() => handleSubmitReview(item, item.requester === myUserId)} disabled={!reviewDrafts[item.id]?.score}>
                    <Text style={[styles.actionLink, !reviewDrafts[item.id]?.score && { opacity: 0.4 }]}>Submit review</Text>
                  </TouchableOpacity>
                </>
              )}
              {item.their_review
                ? <Text style={styles.description}>Their review of you: {item.their_review.score}★{item.their_review.comment ? ` — ${item.their_review.comment}` : ""}</Text>
                : <Text style={styles.description}>{item.my_review ? "The other person has not reviewed yet." : "Reviews stay hidden until you have both reviewed this job."}</Text>}
            </View>
          ) : null}

          {item.scheduled_for ? <Text style={styles.description}>Scheduled for {new Date(item.scheduled_for).toLocaleString()}</Text> : null}
          {(item.requester === myUserId || item.technician === myUserId) && item.status === "COMPLETED" && (
            <TouchableOpacity onPress={() => runAction(async () => { setReceipt(await getServiceReceipt(item.id)); setReceiptId(item.id); })}><Text style={styles.actionLink}>View receipt</Text></TouchableOpacity>
          )}
          {receipt && receiptId === item.id && receiptFor(receipt, item)}
          {item.technician && (item.requester === myUserId || item.technician === myUserId) && item.status !== "CANCELLED" && (
            <>
              <TouchableOpacity onPress={() => setChatId(chatId === item.id ? null : item.id)}><Text style={styles.actionLink}>{chatId === item.id ? "Hide chat" : "Chat"}</Text></TouchableOpacity>
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

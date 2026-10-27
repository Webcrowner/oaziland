"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import Button from "@/components/ui/Button";
import Avatar from "@/components/Avatar";
import ChatLinkText from "@/components/ChatLinkText";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import {
  listConversations,
  getConversationMessages,
  sendConversationMessage,
  markConversationSeen,
  sendTypingHeartbeat,
  getTypingStatus,
  getMyProfile,
  setUserBlocked,
  type ConversationSummary,
  type ConversationMessage,
} from "@/lib/api";
import { IconSearch } from "@/components/Icons";

const QUICK_REPLIES = [
  "Hello, is this still available?",
  "When can I visit to inspect?",
  "Can we discuss the price?",
  "Thank you!",
  "I am interested.",
];

export default function MessagesPage() {
  const t = useTranslations("InboxPage");
  const locale = useLocale();

  const [loggedIn, setLoggedIn] = useState(true);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typingUsernames, setTypingUsernames] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [sendError, setSendError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastHeartbeatRef = useRef<number>(0);
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  // Auto-scroll to bottom of conversation thread
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    }
  }, []);

  // Check URL query parameters for ?conversation=<id>
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const convParam = params.get("conversation");
      if (convParam) {
        void Promise.resolve().then(() => setSelectedId(convParam));
      }
    }
  }, []);

  // Fetch current user's profile to identify incoming vs outgoing messages
  useEffect(() => {
    if (!token) {
      void Promise.resolve().then(() => setLoggedIn(false));
      return;
    }
    getMyProfile(token)
      .then((p) => setMyUserId(p.id))
      .catch(() => {});
  }, [token]);

  const [nowMs, setNowMs] = useState<number>(0);

  // Load conversations list
  const loadConversations = useCallback(() => {
    setNowMs(Date.now());
    if (!token) {
      setLoggedIn(false);
      return;
    }
    listConversations(token)
      .then((data) => setConversations(data.results || []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(() => loadConversations());
    // Refresh so other people's online/last-seen status stays real.
    const interval = setInterval(loadConversations, 20_000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  // Fetch active conversation messages and mark as seen
  useEffect(() => {
    if (!selectedId || !token) return;
    void Promise.resolve().then(() => {
      setLoadingMessages(true);
      setSendError("");
    });
    getConversationMessages(selectedId, token)
      .then((msgs) => {
        setThread(msgs);
        setTimeout(() => scrollToBottom(false), 50);
      })
      .catch(() => {})
      .finally(() => setLoadingMessages(false));

    markConversationSeen(selectedId, token).then(loadConversations);
  }, [selectedId, token, loadConversations, scrollToBottom]);

  // Periodic poll for new messages in active thread (every 4 seconds)
  useEffect(() => {
    if (!selectedId || !token) return;
    const interval = setInterval(() => {
      getConversationMessages(selectedId, token)
        .then((msgs) => {
          setThread((prev) => {
            if (msgs.length !== prev.length || (msgs.length > 0 && msgs[msgs.length - 1].id !== prev[prev.length - 1]?.id)) {
              setTimeout(() => scrollToBottom(true), 50);
              return msgs;
            }
            return prev;
          });
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [selectedId, token, scrollToBottom]);

  // Poll typing status of the other participant every 2.5 seconds
  useEffect(() => {
    if (!selectedId || !token) return;
    const interval = setInterval(() => {
      getTypingStatus(selectedId, token).then((data) => setTypingUsernames(data.typing_usernames));
    }, 2500);
    return () => clearInterval(interval);
  }, [selectedId, token]);

  // Handle typing heartbeat throttled to once every 3 seconds
  function handleDraftChange(value: string) {
    setDraft(value);
    if (!selectedId || !token) return;
    const now = Date.now();
    if (now - lastHeartbeatRef.current > 3000) {
      lastHeartbeatRef.current = now;
      sendTypingHeartbeat(selectedId, token);
    }
  }

  // Send message
  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!selectedId || !token || !draft.trim() || sending) return;
    const textToSend = draft.trim();
    setSending(true);
    setSendError("");
    try {
      const message = await sendConversationMessage(selectedId, textToSend, token);
      setThread((prev) => [...prev, message]);
      setDraft("");
      loadConversations();
      setTimeout(() => scrollToBottom(true), 50);
    } catch {
      setSendError(t("sendFailed"));
    } finally {
      setSending(false);
    }
  }

  async function handleToggleBlock() {
    const target = otherParticipantDetail;
    if (!target || !token || blockBusy) return;
    const blocking = !target.is_blocked;
    if (blocking && !window.confirm(t("blockConfirm", { name: otherParticipantName }))) return;
    setBlockBusy(true);
    try {
      await setUserBlocked(target.id, blocking, token);
      loadConversations();
    } catch {
      setSendError(t("blockFailed"));
    } finally {
      setBlockBusy(false);
    }
  }

  // Filter conversations by search term
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => {
      const names = c.participant_usernames.join(" ").toLowerCase();
      const lastMsg = c.last_message?.text?.toLowerCase() || "";
      return names.includes(q) || lastMsg.includes(q);
    });
  }, [conversations, searchQuery]);

  // Find active conversation
  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === selectedId) || null;
  }, [conversations, selectedId]);

  // Name and avatar of other participant
  const otherParticipantName = activeConversation ? activeConversation.participant_usernames.join(", ") || "Chat" : "";
  const otherParticipantDetail = activeConversation?.participants_details?.[0] ?? null;

  // Format date header nicely
  function presenceLabel(detail?: { is_online: boolean; last_seen_at: string | null } | null) {
    if (!detail) return "";
    if (detail.is_online) return t("online");
    if (!detail.last_seen_at || !nowMs) return t("offline");
    const seconds = Math.round((new Date(detail.last_seen_at).getTime() - nowMs) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { numeric: "auto" });
    const abs = Math.abs(seconds);
    const time =
      abs < 3600 ? rtf.format(Math.round(seconds / 60), "minute")
      : abs < 86400 ? rtf.format(Math.round(seconds / 3600), "hour")
      : rtf.format(Math.round(seconds / 86400), "day");
    return t("lastSeen", { time });
  }

  function formatMessageTime(isoString: string) {
    if (!isoString) return "";
    const date = new Date(isoString);
    return date.toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatConversationTime(isoString: string) {
    if (!isoString) return "";
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return date.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
      month: "short",
      day: "numeric",
    });
  }

  if (!loggedIn) {
    return (
      <AccountSidebarLayout activeHref="/messages">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  return (
    <AccountSidebarLayout activeHref="/messages">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">{t("title")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t("chatEncryptedNotice")}</p>
        </div>
        <Link
          href="/privacy-settings"
          className="text-xs font-semibold text-slate-500 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-2xs hover:bg-slate-50 transition-colors"
        >
          ⚙️ {t("typingSettingsLink")}
        </Link>
      </div>

      {/* Main Messaging Layout Container */}
      <div className="bg-white border border-slate-200/90 rounded-3xl shadow-sm overflow-hidden flex flex-col md:flex-row h-[720px] max-h-[82vh]">
        {/* ========================================================= */}
        {/* LEFT PANEL: CONVERSATIONS LIST                            */}
        {/* ========================================================= */}
        <div
          className={`w-full md:w-80 lg:w-96 border-r border-slate-200 flex flex-col bg-white shrink-0 ${
            selectedId ? "hidden md:flex" : "flex"
          }`}
        >
          {/* Search bar */}
          <div className="p-3.5 border-b border-slate-100">
            <div className="relative">
              <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-400 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs w-4 h-4 rounded-full flex items-center justify-center"
                >
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Conversations scroll area */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {conversations.length === 0 ? (
              <div className="p-8 text-center">
                <span className="text-3xl block mb-2">💬</span>
                <p className="text-xs font-semibold text-slate-700">{t("noConversationsYet")}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Contact an agent, landlord, driver, or technician to start chatting.
                </p>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                {t("noMatchingConversations")}
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = selectedId === conv.id;
                const otherDetail = conv.participants_details?.[0];
                const name = conv.participant_usernames.join(", ") || otherDetail?.full_name || "User";
                const lastMsg = conv.last_message;
                const isMyLastMsg = lastMsg && myUserId && lastMsg.sender === myUserId;

                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      setSelectedId(conv.id);
                    }}
                    className={`w-full text-left p-3.5 flex items-center gap-3 transition-colors cursor-pointer relative ${
                      isSelected
                        ? "bg-amber-50/60 border-l-4 border-amber-400"
                        : "hover:bg-slate-50/80"
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Avatar
                        src={otherDetail?.profile_image_url}
                        name={name}
                        className="w-12 h-12 rounded-2xl bg-slate-900 text-amber-300 font-bold text-sm shadow-xs border border-slate-100"
                      />
                      <span
                        title={otherDetail?.is_online ? t("online") : t("offline")}
                        className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white ${
                          otherDetail?.is_online ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="font-bold text-slate-900 text-xs truncate leading-tight">
                          {name}
                        </p>
                        {lastMsg && (
                          <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                            {formatConversationTime(lastMsg.sent_at || lastMsg.created_at)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-1">
                        <p className={`text-xs truncate ${conv.unread_count > 0 ? "font-bold text-slate-900" : "text-slate-500"}`}>
                          {isMyLastMsg ? <span className="text-slate-400 font-normal">You: </span> : null}
                          {lastMsg ? lastMsg.text : "No messages yet"}
                        </p>

                        {conv.unread_count > 0 && (
                          <span className="bg-amber-400 text-slate-950 font-black text-[10px] rounded-full px-1.5 py-0.2 shrink-0 shadow-2xs">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* RIGHT PANEL: CHAT THREAD & INPUT                          */}
        {/* ========================================================= */}
        <div
          className={`flex-1 flex flex-col relative ${selectedId ? "flex" : "hidden md:flex"}`}
          style={{
            backgroundImage: "url('/images/chat-bg.jpeg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        >
          {!selectedId ? (
            /* Desktop Empty Placeholder */
            <div className="m-auto text-center p-8 max-w-sm bg-white/90 backdrop-blur-md rounded-3xl shadow-lg border border-slate-200/80">
              <div className="w-16 h-16 rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center text-3xl mx-auto mb-4 shadow-sm border border-amber-200/60">
                💬
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">{t("selectConversation")}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                {t("selectConversationSub")}
              </p>
            </div>
          ) : (
            <>
              {/* Active Chat Header */}
              <div className="bg-white/95 backdrop-blur-md px-4 py-3 border-b border-slate-200/90 flex items-center justify-between shadow-2xs shrink-0 z-10">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Mobile Back Button */}
                  <button
                    onClick={() => setSelectedId(null)}
                    className="md:hidden p-1.5 -ml-1 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
                    title={t("backToChats")}
                  >
                    ←
                  </button>

                  <Avatar
                    src={otherParticipantDetail?.profile_image_url}
                    name={otherParticipantName}
                    className="w-10 h-10 rounded-xl bg-slate-900 text-amber-300 font-bold text-xs shadow-xs border border-slate-200 shrink-0"
                  />

                  <div className="min-w-0">
                    <h2 className="font-bold text-slate-900 text-sm truncate leading-snug">
                      {otherParticipantName}
                    </h2>
                    <p className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
                      {typingUsernames.length > 0 ? (
                        <span className="text-emerald-700 font-bold animate-pulse">
                          ✍️ {t("isTyping", { name: typingUsernames.join(", ") })}
                        </span>
                      ) : (
                        <span className={`flex items-center gap-1.5 font-medium ${otherParticipantDetail?.is_online ? "text-emerald-700" : "text-red-600"}`}>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${otherParticipantDetail?.is_online ? "bg-emerald-500" : "bg-red-500"}`}></span>
                          <span>{presenceLabel(otherParticipantDetail)}</span>
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Header Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {otherParticipantDetail?.id && (
                    <button
                      type="button"
                      onClick={handleToggleBlock}
                      disabled={blockBusy}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors shadow-2xs cursor-pointer disabled:opacity-50 ${
                        otherParticipantDetail.is_blocked
                          ? "text-slate-700 bg-white/90 hover:bg-white border-slate-200/90"
                          : "text-red-700 bg-white/90 hover:bg-red-50 border-red-200"
                      }`}
                    >
                      {otherParticipantDetail.is_blocked ? t("unblockUser") : t("blockUser")}
                    </button>
                  )}
                  {otherParticipantDetail?.id && (
                    <Link
                      href={`/user/${otherParticipantDetail.id}`}
                      className="text-xs font-bold text-slate-700 hover:text-slate-900 bg-white/90 hover:bg-white border border-slate-200/90 px-3 py-1.5 rounded-xl transition-colors shadow-2xs"
                    >
                      {t("viewProfile")}
                    </Link>
                  )}
                </div>
              </div>

              {/* Message Thread Area */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-3">
                {loadingMessages && thread.length === 0 ? (
                  <div className="m-auto text-xs text-slate-600 bg-white/80 backdrop-blur-xs px-3 py-1.5 rounded-full shadow-2xs">
                    Loading conversation...
                  </div>
                ) : thread.length === 0 ? (
                  <div className="m-auto text-center p-6 bg-white/90 backdrop-blur-md rounded-2xl border border-slate-200/80 max-w-xs shadow-md">
                    <span className="text-2xl block mb-1">👋</span>
                    <p className="text-xs font-bold text-slate-800">Say hello!</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Send a message to start coordinating your inquiry or deal.
                    </p>
                  </div>
                ) : (
                  thread.map((msg, idx) => {
                    const isMe = Boolean(myUserId && msg.sender === myUserId);
                    const time = formatMessageTime(msg.sent_at || msg.created_at);

                    // Optional date separators
                    const prevMsg = thread[idx - 1];
                    const msgDate = new Date(msg.sent_at || msg.created_at).toDateString();
                    const prevDate = prevMsg ? new Date(prevMsg.sent_at || prevMsg.created_at).toDateString() : null;
                    const showDateDivider = msgDate !== prevDate;

                    return (
                      <div key={msg.id} className="flex flex-col">
                        {showDateDivider && (
                          <div className="flex items-center justify-center my-2">
                            <span className="bg-white/90 backdrop-blur-xs text-slate-700 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-xs border border-slate-200/70">
                              {msgDate === new Date().toDateString()
                                ? "Today"
                                : new Date(msg.sent_at || msg.created_at).toLocaleDateString(
                                    locale === "fr" ? "fr-FR" : "en-US",
                                    { month: "short", day: "numeric", year: "numeric" }
                                  )}
                            </span>
                          </div>
                        )}

                        <div className={`flex items-end gap-2 ${isMe ? "justify-end" : "justify-start"}`}>
                          {!isMe && (
                            <Avatar
                              src={otherParticipantDetail?.profile_image_url}
                              name={msg.sender_name || otherParticipantName}
                              className="w-7 h-7 rounded-lg bg-slate-900 text-amber-300 font-bold text-[10px] shrink-0 mb-1"
                            />
                          )}

                          <div
                            className={`flex flex-col relative max-w-[82%] sm:max-w-md p-3.5 shadow-md ${
                              isMe
                                ? "bg-slate-900 text-white rounded-2xl rounded-br-xs"
                                : "bg-white text-slate-800 border border-slate-200/90 rounded-2xl rounded-bl-xs"
                            }`}
                          >
                            {!isMe && msg.sender_name && (activeConversation?.participant_usernames?.length ?? 0) > 1 && (
                              <p className="text-[10px] font-extrabold text-amber-600 mb-0.5">
                                {msg.sender_name}
                              </p>
                            )}

                            <div className="text-xs sm:text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                              <ChatLinkText text={msg.text} />
                            </div>

                            <div className="flex items-center justify-end gap-1.5 mt-1 -mb-1 select-none">
                              <span className={`text-[10px] font-medium ${isMe ? "text-slate-400" : "text-slate-400"}`}>
                                {time}
                              </span>

                              {isMe && (
                                <span className="text-[11px] leading-none" title={msg.tick_status.seen ? t("seen") : msg.tick_status.delivered ? t("delivered") : t("sent")}>
                                  {msg.tick_status.seen ? (
                                    <span className="text-amber-400 font-black">✓✓</span>
                                  ) : msg.tick_status.delivered ? (
                                    <span className="text-slate-400">✓✓</span>
                                  ) : (
                                    <span className="text-slate-400">✓</span>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {otherParticipantDetail?.is_blocked ? (
                <div className="p-4 bg-white border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3 shrink-0 z-10">
                  <p className="text-xs sm:text-sm text-slate-600">{t("youBlockedThisUser")}</p>
                  <button
                    type="button"
                    onClick={handleToggleBlock}
                    disabled={blockBusy}
                    className="text-xs font-bold px-4 py-2 rounded-xl bg-slate-900 text-amber-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                  >
                    {t("unblockUser")}
                  </button>
                </div>
              ) : (
              <>
              {/* Quick response suggestions strip */}
              <div className="px-3 pt-2 pb-1.5 bg-white/90 backdrop-blur-md border-t border-slate-200/80 flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden shrink-0 z-10">
                {QUICK_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    onClick={() => {
                      setDraft(reply);
                    }}
                    className="whitespace-nowrap bg-white/90 hover:bg-white border border-slate-200/80 text-slate-700 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors shadow-2xs cursor-pointer"
                  >
                    {reply}
                  </button>
                ))}
              </div>

              {sendError && <p className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-700 shrink-0 z-10">{sendError}</p>}
              {/* Message Composer Input Form */}
              <form onSubmit={handleSend} className="p-3 sm:p-3.5 bg-white border-t border-slate-200/80 flex items-center gap-2 shrink-0 z-10">
                <input
                  type="text"
                  placeholder={t("typeMessage")}
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  maxLength={2000}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-amber-300 font-bold px-4 sm:px-5 py-2.5 rounded-2xl text-xs sm:text-sm transition-all shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                >
                  <span>{sending ? t("sending") : t("send")}</span>
                  {!sending && <span>↗</span>}
                </button>
              </form>
              </>
              )}
            </>
          )}
        </div>
      </div>
    </AccountSidebarLayout>
  );
}

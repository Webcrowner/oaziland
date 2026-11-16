"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { translateChatMessage, type ChatTranslation } from "@/lib/api";
import ChatLinkText from "@/components/ChatLinkText";

interface Props {
  conversationId: string;
  messageId: string;
  /** The message as it was written. */
  text: string;
  /** Light text on a dark bubble. */
  onDark?: boolean;
}

/** A "Translate" link under a chat message: shows the message in the reader's language, with a way back to the original. */
export default function ChatTranslate({ conversationId, messageId, text, onDark = false }: Props) {
  const t = useTranslations("ChatTranslate");
  const locale = useLocale();
  const target = locale === "fr" ? "fr" : "en";
  const [result, setResult] = useState<ChatTranslation | null>(null);
  const [showing, setShowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function translate() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      setResult(await translateChatMessage(conversationId, messageId, target, token));
      setShowing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const link = `mt-1 text-[11px] font-semibold underline underline-offset-2 disabled:opacity-60 ${onDark ? "text-amber-300" : "text-[var(--navy)]"}`;
  const note = `mt-1 text-[11px] ${onDark ? "text-slate-300" : "text-slate-500"}`;

  return (
    <div>
      {showing && result && !result.same_language && (
        <div className={`mt-2 border-t pt-2 ${onDark ? "border-white/20" : "border-slate-200"}`}>
          <div className="text-xs sm:text-[13px] leading-relaxed break-words whitespace-pre-wrap"><ChatLinkText text={result.text} /></div>
          <p className={note}>{t("translatedFrom", { language: t(result.source_language === "fr" ? "langFr" : result.source_language === "en" ? "langEn" : "langOther") })}</p>
        </div>
      )}
      {showing && result?.same_language && <p className={note}>{t("alreadyInYourLanguage")}</p>}
      {error && <p role="alert" className="mt-1 text-[11px] text-red-500">{error}</p>}
      {result && showing ? (
        <button type="button" onClick={() => setShowing(false)} className={link}>{t("hideTranslation")}</button>
      ) : result ? (
        <button type="button" onClick={() => setShowing(true)} className={link}>{t("showTranslation")}</button>
      ) : (
        <button type="button" onClick={translate} disabled={busy || !text.trim()} className={link}>{busy ? t("translating") : t("translate")}</button>
      )}
    </div>
  );
}

import { translateEnglish, type Translate } from "../i18n/translate";

export function replyTimeLabel(hours: number, t: Translate = translateEnglish): string {
  if (hours < 1) return t("mkt.trust.replyHour");
  if (hours < 24) return t("mkt.trust.replyHours", { count: Math.ceil(hours) });
  return t("mkt.trust.replyDays", { count: Math.ceil(hours / 24) });
}

export function lastSeenLabel(iso: string, now: Date = new Date(), t: Translate = translateEnglish): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 5) return t("mkt.trust.activeNow");
  if (minutes < 60) return t("mkt.trust.seenMinutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t(hours === 1 ? "mkt.trust.seenHour" : "mkt.trust.seenHours", { count: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? "mkt.trust.seenDay" : "mkt.trust.seenDays", { count: days });
}

export function memberSinceLabel(date: string, t: Translate = translateEnglish, locale?: string): string {
  return t("mkt.trust.memberSince", {
    date: new Date(`${date}T12:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" }),
  });
}

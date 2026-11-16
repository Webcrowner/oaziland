"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  connectChannel, disconnectChannel, listChannelConnections, rotateChannelLink, syncChannel,
  type BookingSiteChannel, type ChannelConnection,
} from "@/lib/api";

const SITES: BookingSiteChannel[] = ["AIRBNB", "BOOKING_COM", "EXPEDIA"];
const field = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-amber-400 focus:outline-none";
const btn = "rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 cursor-pointer";

/** Keeps a guest house's calendar the same on Oaziland and on Airbnb, Booking.com or Vrbo. Each site gives a
 * calendar link (imported hourly, so its bookings block nights here) and takes Oaziland's private calendar link (so
 * Oaziland bookings block nights there). No partner access is needed: these are the standard iCal links. */
export default function ChannelCalendarsPanel({ guestHouseId }: { guestHouseId: string }) {
  const t = useTranslations("ChannelCalendars");
  const locale = useLocale();
  const [connections, setConnections] = useState<ChannelConnection[]>([]);
  const [site, setSite] = useState<BookingSiteChannel>("AIRBNB");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      setConnections(await listChannelConnections(guestHouseId, token));
    } catch {
      setConnections([]);
    }
  }, [guestHouseId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function run(key: string, action: (token: string) => Promise<string>) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await action(token) });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("failed") });
      await load();
    } finally {
      setBusy("");
    }
  }

  function summary(r: { added: number; removed: number; conflicts: string[] }) {
    return r.conflicts.length > 0 ? t("syncedConflicts", { count: r.conflicts.length }) : t("synced", { added: r.added, removed: r.removed });
  }

  async function copy(link: string, key: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      setMessage({ ok: false, text: t("copyFailed") });
    }
  }

  const connected = new Set(connections.map((c) => c.channel));

  return (
    <section className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm" aria-labelledby="channel-calendars-heading">
      <h3 id="channel-calendars-heading" className="text-base font-black text-slate-900">{t("title")}</h3>
      <p className="mt-1 text-xs text-slate-500">{t("intro")}</p>
      {message && (
        <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{message.text}</p>
      )}

      <ul className="mt-4 space-y-4">
        {connections.map((c) => (
          <li key={c.channel} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold text-slate-900">{c.channel_name}</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy === `sync-${c.channel}`} className={`${btn} border-slate-200 text-slate-700 hover:bg-white`}
                  onClick={() => void run(`sync-${c.channel}`, async (token) => summary((await syncChannel(guestHouseId, c.channel, token)).result))}>
                  {t("syncNow")}
                </button>
                <button type="button" disabled={busy === `off-${c.channel}`} className={`${btn} border-rose-200 text-rose-700 hover:bg-rose-50`}
                  onClick={() => { if (window.confirm(t("disconnectConfirm", { site: c.channel_name }))) void run(`off-${c.channel}`, async (token) => { await disconnectChannel(guestHouseId, c.channel, token); return t("disconnected"); }); }}>
                  {t("disconnect")}
                </button>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {c.last_synced_at ? t("lastSynced", { date: new Date(c.last_synced_at).toLocaleString(locale) }) : t("neverSynced")}
            </p>
            {c.last_error && <p role="alert" className="mt-1 text-[11px] font-semibold text-rose-700">{c.last_error}</p>}
            {c.conflict_nights.length > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-amber-800">{t("conflicts", { nights: c.conflict_nights.slice(0, 5).join(", ") })}</p>
            )}
            <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {t("feedLabel", { site: c.channel_name })}
              <div className="mt-1 flex gap-2">
                <input readOnly value={c.feed_url} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs`} />
                <button type="button" className={`${btn} shrink-0 border-slate-900 bg-slate-900 text-white`} onClick={() => void copy(c.feed_url, c.channel)}>
                  {copied === c.channel ? t("copied") : t("copy")}
                </button>
              </div>
            </label>
            <p className="mt-1 text-[11px] text-slate-500">{t("feedHelp", { site: c.channel_name })}</p>
            <button type="button" disabled={busy === `rot-${c.channel}`} className={`${btn} mt-2 border-amber-300 text-amber-800 hover:bg-amber-50`}
              onClick={() => { if (window.confirm(t("rotateConfirm", { site: c.channel_name }))) void run(`rot-${c.channel}`, async (token) => { await rotateChannelLink(guestHouseId, c.channel, token); return t("rotated", { site: c.channel_name }); }); }}>
              {t("rotate")}
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("connect", async (token) => {
            const result = await connectChannel(guestHouseId, site, url.trim(), token);
            setUrl("");
            return t("connected", { site: result.channel.channel_name }) + " " + summary(result.result);
          });
        }}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{connected.has(site) ? t("replaceHeading") : t("addHeading")}</p>
        <div className="flex flex-wrap gap-2">
          <select value={site} onChange={(e) => setSite(e.target.value as BookingSiteChannel)} aria-label={t("siteLabel")} className={`${field} !w-auto`}>
            {SITES.map((s) => <option key={s} value={s}>{t(`site_${s}`)}</option>)}
          </select>
          <input
            required type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("urlPlaceholder")}
            aria-label={t("urlLabel")} className={`${field} min-w-60 flex-1`}
          />
          <button type="submit" disabled={busy === "connect" || !url.trim()} className={`${btn} border-slate-900 bg-slate-900 text-white`}>
            {busy === "connect" ? t("connecting") : t("connect")}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">{t("urlHelp")}</p>
      </form>
    </section>
  );
}

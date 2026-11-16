"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getAdminFeatureSettings, updateAdminFeatureSettings, type AdminFeatureSettings, type AdminFeatureSwitch } from "@/lib/api";

interface Props {
  token: string;
}

/** Admin switches for the features that cost money per use: chat translation, SMS and email. */
export default function AdminFeatureSwitches({ token }: Props) {
  const t = useTranslations("AdminFeatureSwitches");
  const locale = useLocale();
  const [settings, setSettings] = useState<AdminFeatureSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<AdminFeatureSwitch | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await getAdminFeatureSettings(token));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function change(key: AdminFeatureSwitch, value: boolean) {
    setBusy(key);
    setMessage(null);
    try {
      setSettings(await updateAdminFeatureSettings({ [key]: value }, token));
      setMessage({ kind: "ok", text: t(value ? "savedOn" : "savedOff") });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("saveFailed") });
    } finally {
      setBusy(null);
    }
  }

  if (failed) return <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{t("loadFailed")}</p>;
  if (!settings) return <p className="p-4 text-sm text-slate-500">…</p>;

  const providerName = { GOOGLE: t("providerGoogle"), AZURE: t("providerAzure"), SANDBOX: t("providerSandbox"), NONE: t("providerNone") }[settings.translation.provider];

  const cards: { key: AdminFeatureSwitch; icon: string; title: string; text: string; status: string; warning: string; ready: boolean }[] = [
    {
      key: "chat_translation_enabled", icon: "🌐", title: t("translationTitle"), text: t("translationText"),
      status: t("providerLine", { provider: providerName }) + (settings.translation.test_mode ? ` · ${t("testMode")}` : ""),
      warning: settings.translation.ready ? "" : t("translationNotConnected"), ready: settings.translation.ready,
    },
    {
      key: "sms_enabled", icon: "💬", title: t("smsTitle"), text: t("smsText"),
      status: settings.sms_connected ? t("connected") : t("notConnected"), warning: settings.sms_connected ? "" : t("channelNotConnected"), ready: settings.sms_connected,
    },
    {
      key: "email_enabled", icon: "✉️", title: t("emailTitle"), text: t("emailText"),
      status: settings.email_connected ? t("connected") : t("notConnected"), warning: settings.email_connected ? "" : t("channelNotConnected"), ready: settings.email_connected,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-slate-900">🔌 {t("title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("intro")}</p>
      </div>

      <ul className="space-y-3">
        {cards.map((card) => {
          const on = settings[card.key];
          return (
            <li key={card.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start gap-4">
                <span className="text-2xl" aria-hidden>{card.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id={`switch-${card.key}`} className="font-bold text-slate-900">{card.title}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${on ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{on ? t("on") : t("off")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${card.ready ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>{card.status}</span>
                  </div>
                  <p className="mt-1 max-w-2xl text-sm text-slate-600">{card.text}</p>
                  <p className="mt-1 max-w-2xl text-xs text-slate-500">{on ? t("whenOn", { feature: card.title }) : t("whenOff", { feature: card.title })}</p>
                  {card.warning && <p role="note" className="mt-2 max-w-2xl rounded-lg bg-amber-50 p-2 text-xs text-amber-900">⚠ {card.warning}</p>}
                </div>
                <button
                  type="button" role="switch" aria-checked={on} aria-labelledby={`switch-${card.key}`} disabled={busy !== null}
                  onClick={() => change(card.key, !on)}
                  className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? "bg-emerald-500" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="max-w-3xl rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{t("alwaysSent")}</p>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm font-semibold ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}
      <p className="text-xs text-slate-400">{t("lastChanged", { date: new Date(settings.updated_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) })}</p>
    </div>
  );
}

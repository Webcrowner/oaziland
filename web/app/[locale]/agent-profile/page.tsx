"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import QuarterOptions from "@/components/QuarterOptions";
import {
  AGENT_LANGUAGES, AGENT_SPECIALTIES, ApiStatusError, getMyAgentProfile, getMyProfile, listQuarters, updateMyAgentProfile, uploadMediaFile,
  type AgentLanguage, type AgentProfileDetails, type AgentSpecialty, type Quarter,
} from "@/lib/api";

const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 5 * 60;
const MAX_AREAS = 15;
const inputCls = "mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium";
const cardCls = "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm";

/** Reads a video file's length in the browser, before it is uploaded. */
function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
    video.src = url;
  });
}

/** Where an agent edits their public professional profile: bio, specialties, areas, languages and intro video. */
export default function AgentProfileEditorPage() {
  const t = useTranslations("AgentProfileEditor");
  const tDir = useTranslations("AgentsDirectoryPage");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "signedOut" | "notAgent" | "error" | "ready">("loading");
  const [userId, setUserId] = useState("");
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [form, setForm] = useState<AgentProfileDetails | null>(null);
  const [areaToAdd, setAreaToAdd] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [upload, setUpload] = useState<{ percent: number; error: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("access_token");
    void Promise.resolve().then(async () => {
      if (!stored) {
        setState("signedOut");
        return;
      }
      setToken(stored);
      try {
        const [me, details, allQuarters] = await Promise.all([getMyProfile(stored), getMyAgentProfile(stored), listQuarters().catch(() => [])]);
        setUserId(me.id);
        setForm(details);
        setQuarters(allQuarters);
        setState("ready");
      } catch (err) {
        setState(err instanceof ApiStatusError && err.status === 403 ? "notAgent" : "error");
      }
    });
    return () => abortRef.current?.abort();
  }, []);

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function save(changes: Parameters<typeof updateMyAgentProfile>[0], successText: string) {
    if (!token) return false;
    setSaving(true);
    setMessage(null);
    try {
      setForm(await updateMyAgentProfile(changes, token));
      setMessage({ ok: true, text: successText });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("saveFailed") });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    await save({
      bio: form.bio, years_experience: form.years_experience, specialties: form.specialties, languages: form.languages,
      areas_served: form.areas_served.map((a) => a.id),
    }, t("saved"));
  }

  async function pickVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !token) return;
    if (!["video/mp4", "video/quicktime"].includes(file.type)) {
      setUpload({ percent: 0, error: t("videoWrongType") });
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setUpload({ percent: 0, error: t("videoTooBig", { size: Math.ceil(file.size / 1024 / 1024) }) });
      return;
    }
    let seconds: number;
    try {
      seconds = await videoSeconds(file);
    } catch {
      setUpload({ percent: 0, error: t("videoUnreadable") });
      return;
    }
    if (!Number.isFinite(seconds) || seconds > MAX_VIDEO_SECONDS) {
      setUpload({ percent: 0, error: t("videoTooLong") });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setUpload({ percent: 0, error: "" });
    try {
      const result = await uploadMediaFile(file, "agent-intro", token, { onProgress: (percent) => setUpload({ percent, error: "" }), signal: controller.signal });
      const ok = await save({ intro_video_url: result.url, intro_video_seconds: Math.max(1, Math.round(seconds)) }, t("videoSaved"));
      setUpload(ok ? null : { percent: 0, error: "" });
    } catch (err) {
      if (controller.signal.aborted) setUpload(null);
      else setUpload({ percent: 0, error: err instanceof Error ? err.message : t("videoUploadFailed") });
    } finally {
      abortRef.current = null;
    }
  }

  const areaChoices = quarters.filter((q) => !form?.areas_served.some((a) => a.id === q.id));

  return (
    <AccountSidebarLayout activeHref="/agent-profile">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {state === "loading" && <p className="text-sm text-slate-500">{t("loading")}</p>}
      {state === "signedOut" && (
        <div className={`${cardCls} text-center`}>
          <p className="text-sm font-semibold text-slate-700">{t("signInRequired")}</p>
          <Link href="/login" className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">{t("signIn")}</Link>
        </div>
      )}
      {state === "notAgent" && <div className={cardCls}><p className="text-sm text-slate-700">{t("notAgent")}</p></div>}
      {state === "error" && <div role="alert" className={cardCls}><p className="text-sm text-red-700">{t("loadFailed")}</p></div>}

      {state === "ready" && form && (
        <div className="flex flex-col gap-6">
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${message.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              {message.text}
            </p>
          )}

          <section className={cardCls} aria-labelledby="video-title">
            <h2 id="video-title" className="text-lg font-black tracking-tight text-slate-900">{t("videoTitle")}</h2>
            <p className="mt-1 mb-4 text-sm text-slate-500">{t("videoHint")}</p>
            {form.intro_video_url ? (
              <div className="mb-4">
                <video src={form.intro_video_url} controls preload="metadata" playsInline className="w-full max-w-xl rounded-2xl bg-black aspect-video" />
                <button
                  type="button" disabled={saving}
                  onClick={() => save({ intro_video_url: "" }, t("videoRemoved"))}
                  className="mt-2 text-sm font-semibold text-red-700 underline disabled:opacity-50 cursor-pointer"
                >
                  {t("videoRemove")}
                </button>
              </div>
            ) : null}
            {upload && upload.percent > 0 && !upload.error ? (
              <div className="max-w-xl">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={upload.percent} aria-label={t("videoUploading")}>
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${upload.percent}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{t("videoUploadingPercent", { percent: upload.percent })}</span>
                  <button type="button" onClick={() => abortRef.current?.abort()} className="font-semibold underline cursor-pointer">{t("cancel")}</button>
                </div>
              </div>
            ) : (
              <label className="inline-flex cursor-pointer items-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-amber-300 hover:bg-slate-800">
                {form.intro_video_url ? t("videoReplace") : t("videoUpload")}
                <input type="file" accept="video/mp4,video/quicktime" onChange={pickVideo} className="sr-only" />
              </label>
            )}
            {upload?.error && <p role="alert" className="mt-2 text-sm text-red-700">{upload.error}</p>}
          </section>

          <form onSubmit={saveDetails} className={`${cardCls} flex flex-col gap-4`} aria-labelledby="details-title">
            <h2 id="details-title" className="text-lg font-black tracking-tight text-slate-900">{t("detailsTitle")}</h2>
            <label className="text-xs font-bold text-slate-600">
              {t("bioLabel")}
              <textarea
                rows={5} maxLength={1500} value={form.bio} placeholder={t("bioPlaceholder")}
                onChange={(e) => setForm({ ...form, bio: e.target.value })} className={inputCls}
              />
              <span className="mt-1 block text-right font-normal text-slate-400">{form.bio.length}/1500</span>
            </label>
            <label className="text-xs font-bold text-slate-600 max-w-xs">
              {t("yearsLabel")}
              <input
                type="number" min={0} max={60} value={form.years_experience ?? ""}
                onChange={(e) => setForm({ ...form, years_experience: e.target.value === "" ? null : Number(e.target.value) })} className={inputCls}
              />
            </label>
            <fieldset>
              <legend className="text-xs font-bold text-slate-600">{t("specialtiesLabel")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {AGENT_SPECIALTIES.map((code) => (
                  <label key={code} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${form.specialties.includes(code) ? "border-slate-900 bg-slate-900 text-amber-300" : "border-slate-300 bg-white text-slate-700"}`}>
                    <input type="checkbox" className="sr-only" checked={form.specialties.includes(code)} onChange={() => setForm({ ...form, specialties: toggle<AgentSpecialty>(form.specialties, code) })} />
                    {tDir(`specialty_${code}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-xs font-bold text-slate-600">{t("languagesLabel")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {AGENT_LANGUAGES.map((code) => (
                  <label key={code} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${form.languages.includes(code) ? "border-slate-900 bg-slate-900 text-amber-300" : "border-slate-300 bg-white text-slate-700"}`}>
                    <input type="checkbox" className="sr-only" checked={form.languages.includes(code)} onChange={() => setForm({ ...form, languages: toggle<AgentLanguage>(form.languages, code) })} />
                    {tDir(`language_${code}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <p className="text-xs font-bold text-slate-600">{t("areasLabel", { max: MAX_AREAS })}</p>
              {form.areas_served.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {form.areas_served.map((area) => (
                    <li key={area.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {area.name}
                      <button
                        type="button" aria-label={t("areaRemove", { name: area.name })}
                        onClick={() => setForm({ ...form, areas_served: form.areas_served.filter((a) => a.id !== area.id) })}
                        className="ml-1 font-bold text-slate-500 hover:text-red-700 cursor-pointer"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {form.areas_served.length < MAX_AREAS && (
                <div className="mt-2 flex max-w-md gap-2">
                  <select aria-label={t("areaChoose")} value={areaToAdd} onChange={(e) => setAreaToAdd(e.target.value)} className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option value="">{t("areaChoose")}</option>
                    <QuarterOptions quarters={areaChoices} />
                  </select>
                  <button
                    type="button" disabled={!areaToAdd}
                    onClick={() => {
                      const quarter = quarters.find((q) => q.id === areaToAdd);
                      if (quarter) setForm({ ...form, areas_served: [...form.areas_served, { id: quarter.id, name: quarter.name }] });
                      setAreaToAdd("");
                    }}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {t("areaAdd")}
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={saving} className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50 cursor-pointer">
                {saving ? t("saving") : t("save")}
              </button>
              {userId && <Link href={`/agents/${userId}`} className="text-sm font-semibold text-slate-600 underline">{t("viewPublic")}</Link>}
            </div>
          </form>
        </div>
      )}
    </AccountSidebarLayout>
  );
}

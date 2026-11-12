"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  activateCertificateTemplate, createCertificateTemplate, deleteCertificateTemplate, duplicateCertificateTemplate,
  listCertificateTemplates, previewCertificateTemplate, removeCertificateFile, switchToBuiltinCertificate,
  updateCertificateTemplate, uploadCertificateFile,
  type CertificateElement, type CertificateOrientation, type CertificateTemplate, type CertificateTemplateList,
  type CertificateFileKind, type CertificateTextElement,
} from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";
import CertificateCanvas, { DESIGN_WIDTH, designHeight } from "@/components/admin/CertificateCanvas";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
}

const PLACEHOLDERS = [
  "learner_name", "course_title", "trainer_name", "issue_date", "certificate_code", "verify_url", "lessons",
  "course_hours", "final_grade", "completion_date", "expiry_date",
] as const;
const input =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-amber-500 focus:outline-none";
const smallButton =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-700 disabled:opacity-40";
const primaryButton =
  "rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50";

/** Admin console → Certificates: the templates the system uses to issue course certificates. */
export default function AdminCertificateDesigner({ token, dialogs }: Props) {
  const t = useTranslations("CertificateDesigner");
  const [data, setData] = useState<CertificateTemplateList | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<CertificateTemplate | null>(null);
  const [newName, setNewName] = useState("");
  const [startFrom, setStartFrom] = useState<"default" | "empty">("default");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listCertificateTemplates(token));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error) {
      await dialogs.notify(error instanceof Error ? error.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <TemplateEditor
        token={token}
        dialogs={dialogs}
        initial={editing}
        onClose={() => { setEditing(null); load(); }}
      />
    );
  }

  if (failed) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{t("loadFailed")}</p>;
  if (!data) return <p className="p-4 text-sm text-slate-500">…</p>;

  const active = data.results.find((item) => item.is_active);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">🎓 {t("title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("intro")}</p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
          ✓ {t("inUse", { name: active ? active.name : t("builtinName") })}
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newName.trim()) return;
          run(async () => {
            const created = await createCertificateTemplate(newName.trim(), startFrom, token);
            setNewName("");
            setEditing(created);
          });
        }}
      >
        <label className="min-w-[14rem] flex-1 text-xs font-semibold text-slate-600">
          {t("newName")}
          <input className={`${input} mt-1`} value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} placeholder={t("newNamePlaceholder")} />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          {t("startFrom")}
          <select className={`${input} mt-1`} value={startFrom} onChange={(e) => setStartFrom(e.target.value as "default" | "empty")}>
            <option value="default">{t("startDefault")}</option>
            <option value="empty">{t("startEmpty")}</option>
          </select>
        </label>
        <button type="submit" className={primaryButton} disabled={busy || !newName.trim()}>+ {t("create")}</button>
        <p className="basis-full text-xs text-slate-500">{t("startHint")}</p>
      </form>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <TemplateCard
          title={t("builtinName")}
          subtitle={t("builtinHint")}
          active={data.builtin_active}
          activeLabel={t("activeBadge")}
          canvas={
            <CertificateCanvas
              orientation="LANDSCAPE" backgroundColor={data.default_background_color} backgroundImageUrl="" logoUrl=""
              layout={data.default_layout} lang="en"
            />
          }
        >
          {!data.builtin_active && (
            <button className={smallButton} disabled={busy} onClick={() => run(() => switchToBuiltinCertificate(token))}>
              {t("useThis")}
            </button>
          )}
        </TemplateCard>
        {data.results.map((template) => (
          <TemplateCard
            key={template.id}
            title={template.name}
            subtitle={`${template.orientation === "PORTRAIT" ? t("portrait") : t("landscape")} · ${t("usedBy", { count: template.course_count })}`}
            active={template.is_active}
            activeLabel={t("activeBadge")}
            canvas={
              <CertificateCanvas
                orientation={template.orientation} backgroundColor={template.background_color}
                backgroundImageUrl={template.background_image_url} logoUrl={template.logo_url}
                signatureUrl={template.signature_url} layout={template.layout} lang="en"
              />
            }
          >
            <button className={smallButton} disabled={busy} onClick={() => setEditing(template)}>✏️ {t("edit")}</button>
            {!template.is_active && (
              <button
                className={smallButton}
                disabled={busy}
                onClick={async () => {
                  if (await dialogs.confirm(t("activateConfirm", { name: template.name }), { confirmLabel: t("useThis") })) {
                    run(() => activateCertificateTemplate(template.id, token));
                  }
                }}
              >
                {t("useThis")}
              </button>
            )}
            <button className={smallButton} disabled={busy} onClick={() => run(() => duplicateCertificateTemplate(template.id, token))}>{t("duplicate")}</button>
            <button
              className={`${smallButton} hover:!border-red-300 hover:!text-red-600`}
              disabled={busy}
              onClick={async () => {
                const message = [
                  template.is_active ? t("deleteActiveConfirm", { name: template.name }) : t("deleteConfirm", { name: template.name }),
                  template.course_count ? t("deleteCoursesWarning", { count: template.course_count }) : "",
                ].filter(Boolean).join(" ");
                if (await dialogs.confirm(message, { confirmLabel: t("delete"), destructive: true })) {
                  run(() => deleteCertificateTemplate(template.id, token));
                }
              }}
            >
              {t("delete")}
            </button>
          </TemplateCard>
        ))}
      </ul>
    </div>
  );
}

function TemplateCard({ title, subtitle, active, activeLabel, canvas, children }: {
  title: string; subtitle: string; active: boolean; activeLabel: string; canvas: ReactNode; children: ReactNode;
}) {
  return (
    <li className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${active ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200"}`}>
      <div className="pointer-events-none border-b border-slate-100 bg-slate-50 p-3">
        <div className="mx-auto max-w-[22rem] shadow">{canvas}</div>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          {active && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-700">{activeLabel}</span>}
        </div>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ editor

let idCounter = 0;
const newId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

function TemplateEditor({ token, dialogs, initial, onClose }: Props & { initial: CertificateTemplate; onClose: () => void }) {
  const t = useTranslations("CertificateDesigner");
  const [template, setTemplate] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [orientation, setOrientation] = useState<CertificateOrientation>(initial.orientation);
  const [backgroundColor, setBackgroundColor] = useState(initial.background_color);
  const [layout, setLayout] = useState<CertificateElement[]>(initial.layout);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "fr">("en");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);
  const [drawing, setDrawing] = useState(false);
  const canvasWrapper = useRef<HTMLDivElement>(null);

  const pageHeight = designHeight(orientation);
  const selected = layout.find((element) => element.id === selectedId) ?? null;
  const settings = { name, orientation, background_color: backgroundColor, layout };

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const adopt = (saved: CertificateTemplate) => {
    setTemplate(saved);
    setName(saved.name);
    setOrientation(saved.orientation);
    setBackgroundColor(saved.background_color);
    setLayout(saved.layout);
    setDirty(false);
  };

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  };

  const guarded = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      await dialogs.notify(error instanceof Error ? error.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const save = () => guarded(async () => {
    adopt(await updateCertificateTemplate(template.id, settings, token));
    flash(t("saved"));
  });

  const saveIfDirty = async () => {
    if (dirty) adopt(await updateCertificateTemplate(template.id, settings, token));
  };

  const change = (id: string, patch: Partial<CertificateElement>) => {
    setLayout((current) => current.map((element) => (element.id === id ? ({ ...element, ...patch } as CertificateElement) : element)));
    setDirty(true);
  };

  const add = (element: CertificateElement) => {
    setLayout((current) => [...current, element]);
    setSelectedId(element.id);
    setDirty(true);
  };

  const remove = (id: string) => {
    setLayout((current) => current.filter((element) => element.id !== id));
    setSelectedId(null);
    setDirty(true);
  };

  const move = (id: string, step: -1 | 1) => {
    setLayout((current) => {
      const index = current.findIndex((element) => element.id === id);
      const target = index + step;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  };

  const addText = (text: string) =>
    add({
      id: newId("text"), type: "text", x: 250, y: Math.round(pageHeight / 2 - 15), w: 500, text, text_fr: "",
      font: "sans", bold: false, size: 20, color: "#0F172A", align: "center", single_line: true,
    });

  const changeOrientation = (next: CertificateOrientation) => {
    if (next === orientation) return;
    const ratio = designHeight(next) / designHeight(orientation);
    setLayout((current) =>
      current.map((element) => ({ ...element, y: element.y * ratio, ...(element.type === "rect" ? { h: element.h * ratio } : {}) })),
    );
    setOrientation(next);
    setDirty(true);
  };

  /** Just above the first signature line, where people expect it; else the lower left of the page. */
  const signatureElement = (current: CertificateElement[]): CertificateElement => {
    const line = current.find((element) => element.type === "line");
    const w = 180;
    return line
      ? { id: newId("signature"), type: "signature", x: Math.round(line.x + (line.w - w) / 2), y: Math.round(line.y - 66), w }
      : { id: newId("signature"), type: "signature", x: 160, y: Math.round(pageHeight * 0.68), w };
  };

  const addSignature = () => add(signatureElement(layout));

  const upload = (kind: CertificateFileKind, file: File | undefined) => {
    if (!file) return;
    guarded(async () => {
      await saveIfDirty();
      const saved = await uploadCertificateFile(template.id, kind, file, token);
      // A new signature is placed on the page right away, so it isn't saved without appearing anywhere.
      if (kind === "signature" && !saved.layout.some((element) => element.type === "signature")) {
        const element = signatureElement(saved.layout);
        adopt(await updateCertificateTemplate(template.id, { layout: [...saved.layout, element] }, token));
        setSelectedId(element.id);
      } else {
        adopt(saved);
      }
      flash({ background: t("backgroundUploaded"), logo: t("logoUploaded"), signature: t("signatureSaved") }[kind]);
    });
  };

  const removeFile = (kind: CertificateFileKind) =>
    guarded(async () => {
      await saveIfDirty();
      adopt(await removeCertificateFile(template.id, kind, token));
    });

  const preview = () => guarded(async () => {
    setPreviewUrl(await previewCertificateTemplate(template.id, settings, lang, token));
  });

  const activate = () => guarded(async () => {
    if (!(await dialogs.confirm(t("activateConfirm", { name }), { confirmLabel: t("useThis") }))) return;
    await saveIfDirty();
    adopt(await activateCertificateTemplate(template.id, token));
    flash(t("activated"));
  });

  const close = async () => {
    if (dirty && !(await dialogs.confirm(t("discardConfirm"), { confirmLabel: t("discard"), destructive: true }))) return;
    onClose();
  };

  const onCanvasKey = (event: KeyboardEvent) => {
    if (!selected || event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      change(selected.id, { x: selected.x + moves[event.key][0], y: selected.y + moves[event.key][1] });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(selected.id);
    }
  };

  const elementLabel = (element: CertificateElement) => {
    if (element.type === "text") return `T · ${element.text.slice(0, 32) || t("emptyText")}`;
    return {
      logo: `🖼 ${t("logo")}`, signature: `✍ ${t("signature")}`, qr: `▦ ${t("qrCode")}`, line: `― ${t("line")}`, rect: `▭ ${t("frame")}`,
    }[element.type];
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className={smallButton} onClick={close}>← {t("back")}</button>
        <h2 className="text-lg font-bold text-slate-900">{name || t("untitled")}</h2>
        {template.is_active && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-700">{t("activeBadge")}</span>}
        {dirty && <span className="text-xs font-semibold text-amber-700">● {t("unsaved")}</span>}
        {notice && <span role="status" className="text-xs font-semibold text-emerald-700">✓ {notice}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={smallButton} disabled={busy} onClick={preview}>👁 {t("preview")}</button>
          {!template.is_active && <button className={smallButton} disabled={busy} onClick={activate}>{t("useThis")}</button>}
          <button className={primaryButton} disabled={busy || !dirty} onClick={save}>{t("save")}</button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-600">{t("add")}:</span>
            <button className={smallButton} onClick={() => addText(t("newText"))}>T {t("text")}</button>
            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
              value=""
              onChange={(e) => e.target.value && addText(`{${e.target.value}}`)}
              aria-label={t("addField")}
            >
              <option value="">{t("addField")}…</option>
              {PLACEHOLDERS.map((key) => <option key={key} value={key}>{t(`ph_${key}`)}</option>)}
            </select>
            {!layout.some((e) => e.type === "logo") && (
              <button className={smallButton} onClick={() => add({ id: newId("logo"), type: "logo", x: 450, y: 40, w: 100 })}>🖼 {t("logo")}</button>
            )}
            {!layout.some((e) => e.type === "signature") && (
              <button className={smallButton} onClick={addSignature}>✍ {t("signature")}</button>
            )}
            {!layout.some((e) => e.type === "qr") && (
              <button className={smallButton} onClick={() => add({ id: newId("qr"), type: "qr", x: 860, y: pageHeight - 140, w: 90, color: "#000000" })}>▦ {t("qrCode")}</button>
            )}
            <button className={smallButton} onClick={() => add({ id: newId("line"), type: "line", x: 350, y: Math.round(pageHeight / 2), w: 300, thickness: 1.5, color: "#CBD5E1" })}>― {t("line")}</button>
            <button className={smallButton} onClick={() => add({ id: newId("rect"), type: "rect", x: 20, y: 20, w: DESIGN_WIDTH - 40, h: pageHeight - 40, thickness: 4, color: "#C9A227" })}>▭ {t("frame")}</button>
            <span className="ml-auto inline-flex overflow-hidden rounded-lg border border-slate-200">
              {(["en", "fr"] as const).map((code) => (
                <button key={code} className={`px-2.5 py-1.5 font-bold ${lang === code ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`} onClick={() => setLang(code)}>
                  {code.toUpperCase()}
                </button>
              ))}
            </span>
          </div>

          <div
            ref={canvasWrapper}
            tabIndex={0}
            onKeyDown={onCanvasKey}
            onPointerDownCapture={() => canvasWrapper.current?.focus({ preventScroll: true })}
            className="rounded-xl bg-slate-200 p-3 outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:p-6"
            aria-label={t("canvasLabel")}
          >
            <div className="mx-auto shadow-xl" style={{ maxWidth: orientation === "PORTRAIT" ? "34rem" : "60rem" }}>
              <CertificateCanvas
                orientation={orientation} backgroundColor={backgroundColor} backgroundImageUrl={template.background_image_url}
                logoUrl={template.logo_url} signatureUrl={template.signature_url} signaturePlaceholder={t("signatureMissing")}
                layout={layout} lang={lang} selectedId={selectedId}
                onSelect={setSelectedId} onChange={change} resizeLabel={t("resize")}
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">{t("canvasHint")}</p>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          {selected ? (
            <ElementPanel
              element={selected}
              pageHeight={pageHeight}
              onChange={(patch) => change(selected.id, patch)}
              onRemove={() => remove(selected.id)}
              onLayer={(step) => move(selected.id, step)}
              onReplaceLogo={() => logoInput.current?.click()}
              onDrawSignature={() => setDrawing(true)}
              onUploadSignature={() => signatureInput.current?.click()}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500">{t("selectHint")}</p>
          )}

          <Section title={t("pageSettings")}>
            <Field label={t("name")}>
              <input className={input} value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
            </Field>
            <Field label={t("orientation")}>
              <select className={input} value={orientation} onChange={(e) => changeOrientation(e.target.value as CertificateOrientation)}>
                <option value="LANDSCAPE">{t("landscape")}</option>
                <option value="PORTRAIT">{t("portrait")}</option>
              </select>
            </Field>
            <Field label={t("backgroundColor")}>
              <ColorInput value={backgroundColor} onChange={(value) => { setBackgroundColor(value); setDirty(true); }} />
            </Field>
            <Field label={t("backgroundFile")} hint={t("backgroundHint")} group>
              <div className="flex flex-wrap gap-2">
                <button className={smallButton} disabled={busy} onClick={() => backgroundInput.current?.click()}>
                  ⬆ {template.background_image_url ? t("replace") : t("upload")}
                </button>
                {template.background_image_url && (
                  <button className={smallButton} disabled={busy} onClick={() => removeFile("background")}>{t("remove")}</button>
                )}
              </div>
            </Field>
            <Field label={t("logo")} hint={t("logoHint")} group>
              <div className="flex flex-wrap gap-2">
                <button className={smallButton} disabled={busy} onClick={() => logoInput.current?.click()}>⬆ {t("changeLogo")}</button>
                {template.logo_url && <button className={smallButton} disabled={busy} onClick={() => removeFile("logo")}>{t("resetLogo")}</button>}
              </div>
            </Field>
            <Field label={t("signature")} group>
              {template.signature_url ? (
                <div className="rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={template.signature_url} alt={t("signature")} className="mx-auto max-h-16 w-auto" />
                </div>
              ) : (
                <span className="block text-[11px] text-slate-500">{t("signatureNone")}</span>
              )}
              <div className="flex flex-wrap gap-2">
                <button className={smallButton} disabled={busy} onClick={() => setDrawing(true)}>✍ {t("signatureDraw")}</button>
                <button className={smallButton} disabled={busy} onClick={() => signatureInput.current?.click()}>⬆ {t("signatureUpload")}</button>
                {template.signature_url && (
                  <button className={smallButton} disabled={busy} onClick={() => removeFile("signature")}>{t("remove")}</button>
                )}
              </div>
              <p className="rounded-lg bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">💡 {t("signatureUploadTip")}</p>
            </Field>
            <input
              ref={signatureInput} type="file" hidden accept="image/png,image/webp,image/jpeg"
              onChange={(e) => { upload("signature", e.target.files?.[0]); e.target.value = ""; }}
            />
            <input
              ref={backgroundInput} type="file" hidden accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => { upload("background", e.target.files?.[0]); e.target.value = ""; }}
            />
            <input
              ref={logoInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(e) => { upload("logo", e.target.files?.[0]); e.target.value = ""; }}
            />
          </Section>

          <Section title={t("layers")}>
            <ol className="max-h-64 space-y-1 overflow-y-auto">
              {[...layout].reverse().map((element) => (
                <li key={element.id}>
                  <button
                    className={`w-full truncate rounded-lg px-2 py-1 text-left text-xs ${element.id === selectedId ? "bg-amber-100 font-semibold text-amber-900" : "text-slate-700 hover:bg-slate-100"}`}
                    onClick={() => setSelectedId(element.id)}
                  >
                    {elementLabel(element)}
                  </button>
                </li>
              ))}
            </ol>
          </Section>

          <Section title={t("fieldsTitle")}>
            <p className="text-xs text-slate-500">{t("fieldsHint")}</p>
            <ul className="space-y-1 text-xs">
              {PLACEHOLDERS.map((key) => (
                <li key={key}><code className="rounded bg-slate-100 px-1 font-semibold text-slate-800">{`{${key}}`}</code> — {t(`ph_${key}`)}</li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500">{t("fieldsEmptyHint")}</p>
          </Section>
        </aside>
      </div>

      {drawing && (
        <SignaturePad
          onCancel={() => setDrawing(false)}
          onSave={(file) => { setDrawing(false); upload("signature", file); }}
        />
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4" role="dialog" aria-modal="true" onClick={() => setPreviewUrl(null)}>
          <div className="max-h-full max-w-5xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-sm text-slate-600">{t("previewHint")}</p>
              <button className={smallButton} onClick={() => setPreviewUrl(null)}>{t("close")}</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt={t("preview")} className="mx-auto max-h-[75vh] w-auto border border-slate-200" />
          </div>
        </div>
      )}
    </div>
  );
}

function ElementPanel({ element, pageHeight, onChange, onRemove, onLayer, onReplaceLogo, onDrawSignature, onUploadSignature }: {
  element: CertificateElement;
  pageHeight: number;
  onChange: (patch: Partial<CertificateElement>) => void;
  onRemove: () => void;
  onLayer: (step: -1 | 1) => void;
  onReplaceLogo: () => void;
  onDrawSignature: () => void;
  onUploadSignature: () => void;
}) {
  const t = useTranslations("CertificateDesigner");
  const title = { text: t("text"), logo: t("logo"), signature: t("signature"), qr: t("qrCode"), line: t("line"), rect: t("frame") }[element.type];
  return (
    <Section title={title}>
      {element.type === "text" && <TextFields element={element} onChange={onChange} />}
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="X" value={element.x} min={-DESIGN_WIDTH} max={DESIGN_WIDTH} onChange={(x) => onChange({ x })} />
        <NumberField label="Y" value={element.y} min={-pageHeight} max={pageHeight} onChange={(y) => onChange({ y })} />
        <NumberField label={element.type === "qr" ? t("size") : t("width")} value={element.w} min={1} max={DESIGN_WIDTH * 2} onChange={(w) => onChange({ w })} />
        {element.type === "rect" && <NumberField label={t("height")} value={element.h} min={1} max={pageHeight * 2} onChange={(h) => onChange({ h })} />}
        {(element.type === "line" || element.type === "rect") && (
          <NumberField label={t("thickness")} value={element.thickness} step={0.5} min={0.2} max={60} onChange={(thickness) => onChange({ thickness })} />
        )}
      </div>
      {(element.type === "qr" || element.type === "line" || element.type === "rect") && (
        <Field label={t("color")}><ColorInput value={element.color} onChange={(color) => onChange({ color })} /></Field>
      )}
      {element.type === "logo" && <button className={smallButton} onClick={onReplaceLogo}>⬆ {t("changeLogo")}</button>}
      {element.type === "signature" && (
        <div className="flex flex-wrap gap-2">
          <button className={smallButton} onClick={onDrawSignature}>✍ {t("signatureDraw")}</button>
          <button className={smallButton} onClick={onUploadSignature}>⬆ {t("signatureUpload")}</button>
        </div>
      )}
      {element.type === "qr" && <p className="text-xs text-slate-500">{t("qrHint")}</p>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <button className={smallButton} onClick={() => onLayer(1)} title={t("bringForward")}>↑ {t("bringForward")}</button>
        <button className={smallButton} onClick={() => onLayer(-1)} title={t("sendBackward")}>↓ {t("sendBackward")}</button>
        <button className={`${smallButton} hover:!border-red-300 hover:!text-red-600`} onClick={onRemove}>🗑 {t("delete")}</button>
      </div>
    </Section>
  );
}

function TextFields({ element, onChange }: { element: CertificateTextElement; onChange: (patch: Partial<CertificateTextElement>) => void }) {
  const t = useTranslations("CertificateDesigner");
  return (
    <>
      <Field label={t("textEn")}>
        <textarea className={input} rows={2} value={element.text} maxLength={500} onChange={(e) => onChange({ text: e.target.value })} />
      </Field>
      <Field label={t("textFr")} hint={t("textFrHint")}>
        <textarea className={input} rows={2} value={element.text_fr} maxLength={500} onChange={(e) => onChange({ text_fr: e.target.value })} />
      </Field>
      <div className="flex flex-wrap gap-1">
        {PLACEHOLDERS.map((key) => (
          <button key={key} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-amber-100" title={t(`ph_${key}`)} onClick={() => onChange({ text: `${element.text}{${key}}` })}>
            {`{${key}}`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("font")}>
          <select className={input} value={element.font} onChange={(e) => onChange({ font: e.target.value as "sans" | "serif" })}>
            <option value="sans">{t("fontSans")}</option>
            <option value="serif">{t("fontSerif")}</option>
          </select>
        </Field>
        <NumberField label={t("fontSize")} value={element.size} step={0.5} min={4} max={200} onChange={(size) => onChange({ size })} />
        <Field label={t("color")}><ColorInput value={element.color} onChange={(color) => onChange({ color })} /></Field>
        <Field label={t("align")} group>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                className={`flex-1 py-1.5 text-xs font-bold ${element.align === align ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}
                onClick={() => onChange({ align })}
                title={t(`align_${align}`)}
              >
                {{ left: "⇤", center: "↔", right: "⇥" }[align]}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={element.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> {t("bold")}
      </label>
      <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <input type="checkbox" checked={element.single_line} onChange={(e) => onChange({ single_line: e.target.checked })} /> {t("singleLine")}
      </label>
    </>
  );
}

const PAD_WIDTH = 1200;
const PAD_HEIGHT = 400;
const INK_COLORS = ["#0F172A", "#1E3A8A"] as const;

/** Sign with a mouse, finger or stylus on a transparent canvas; saved as a PNG like an uploaded signature. */
function SignaturePad({ onCancel, onSave }: { onCancel: () => void; onSave: (file: File) => void }) {
  const t = useTranslations("CertificateDesigner");
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [ink, setInk] = useState<string>(INK_COLORS[0]);
  const [empty, setEmpty] = useState(true);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * PAD_WIDTH, y: ((event.clientY - box.top) / box.height) * PAD_HEIGHT };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, pressure: number) => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.strokeStyle = ink;
    context.lineWidth = 3 + 4 * (pressure || 0.5);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  };

  const clear = () => {
    canvas.current?.getContext("2d")?.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    setEmpty(true);
  };

  const save = () => {
    canvas.current?.toBlob((blob) => blob && onSave(new File([blob], "signature.png", { type: "image/png" })), "image/png");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4" role="dialog" aria-modal="true" aria-label={t("signatureDrawTitle")}>
      <div className="w-full max-w-3xl space-y-3 rounded-2xl bg-white p-4 shadow-2xl">
        <div>
          <h3 className="font-bold text-slate-900">✍ {t("signatureDrawTitle")}</h3>
          <p className="text-xs text-slate-500">{t("signatureDrawHint")}</p>
        </div>
        <div className="relative rounded-xl border-2 border-dashed border-slate-300 bg-white">
          <canvas
            ref={canvas}
            width={PAD_WIDTH}
            height={PAD_HEIGHT}
            className="block aspect-[3/1] w-full cursor-crosshair touch-none"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const at = point(event);
              last.current = at;
              stroke(at, { x: at.x + 0.1, y: at.y }, event.pressure);
              setEmpty(false);
            }}
            onPointerMove={(event) => {
              if (!last.current) return;
              const at = point(event);
              stroke(last.current, at, event.pressure);
              last.current = at;
            }}
            onPointerUp={() => { last.current = null; }}
            onPointerCancel={() => { last.current = null; }}
          />
          <div className="pointer-events-none absolute inset-x-8 bottom-[22%] border-b border-slate-300" />
          {empty && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm italic text-slate-400">
              {t("signatureDrawPlaceholder")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">{t("signatureInk")}:</span>
          {INK_COLORS.map((color) => (
            <button
              key={color}
              className={`h-7 w-7 rounded-full border-2 ${ink === color ? "border-amber-500 ring-2 ring-amber-200" : "border-white"}`}
              style={{ background: color }}
              onClick={() => setInk(color)}
              aria-label={color === INK_COLORS[0] ? t("signatureInkBlack") : t("signatureInkBlue")}
              aria-pressed={ink === color}
            />
          ))}
          <button className={`${smallButton} ml-2`} onClick={clear} disabled={empty}>{t("signatureClear")}</button>
          <div className="ml-auto flex gap-2">
            <button className={smallButton} onClick={onCancel}>{t("cancel")}</button>
            <button className={primaryButton} onClick={save} disabled={empty}>{t("signatureUse")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

/** A labelled control; group=true for several buttons (a <label> would make its text click the first one). */
function Field({ label, hint, group = false, children }: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  const Wrapper = group ? "div" : "label";
  return (
    <Wrapper className="block space-y-1">
      <span className="block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </Wrapper>
  );
}

function NumberField({ label, value, onChange, step = 1, min, max }: {
  label: string; value: number; onChange: (value: number) => void; step?: number; min: number; max: number;
}) {
  return (
    <label className="space-y-1 text-xs font-semibold text-slate-600">
      <span>{label}</span>
      <input
        type="number" className={input} value={Math.round(value * 100) / 100} step={step} min={min} max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(next)) onChange(Math.min(Math.max(next, min), max));
        }}
      />
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    // The colour changed elsewhere (e.g. the picker): show it in the text box too.
    setShown(value);
    setText(value);
  }
  return (
    <div className="flex items-center gap-2">
      <input type="color" className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-white" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <input
        className={`${input} font-mono`} value={text} maxLength={7} aria-label="HEX"
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
        }}
      />
    </div>
  );
}

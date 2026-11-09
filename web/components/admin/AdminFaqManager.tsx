"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAdminDialogs } from "@/components/admin/useAdminDialogs";
import {
  createAdminFaq, deleteAdminFaq, listAdminFaqs, reorderAdminFaqs, updateAdminFaq, type AdminFaq, type AdminFaqInput,
} from "@/lib/api";

const EMPTY: Required<AdminFaqInput> = {
  question_en: "", answer_en: "", question_fr: "", answer_fr: "", is_published: true, show_on_homepage: true,
};

const inputClass =
  "w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";
const labelClass = "block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1";
const smallBtn =
  "px-2.5 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed";

/** Admin console panel: add, edit, reorder, hide and delete FAQ entries (English + optional French). */
export default function AdminFaqManager() {
  const tAdmin = useTranslations("AdminConsolePage");
  const dialogs = useAdminDialogs();
  const [faqs, setFaqs] = useState<AdminFaq[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<Required<AdminFaqInput>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const token = () => localStorage.getItem("access_token") ?? "";

  const load = useCallback(async () => {
    try {
      setFaqs(await listAdminFaqs(token()));
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  function startNew() {
    setForm(EMPTY);
    setEditingId("new");
    setMessage("");
  }

  function startEdit(faq: AdminFaq) {
    setForm({
      question_en: faq.question_en, answer_en: faq.answer_en, question_fr: faq.question_fr, answer_fr: faq.answer_fr,
      is_published: faq.is_published, show_on_homepage: faq.show_on_homepage,
    });
    setEditingId(faq.id);
    setMessage("");
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
      setMessage(success);
      return true;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : tAdmin("faqGenericError"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => (editingId === "new" ? createAdminFaq(form, token()) : updateAdminFaq(editingId as number, form, token())),
      editingId === "new" ? tAdmin("faqAdded") : tAdmin("faqSaved")
    );
    if (ok) setEditingId(null);
  }

  function move(index: number, direction: -1 | 1) {
    const ids = faqs.map((f) => f.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    run(() => reorderAdminFaqs(ids, token()), tAdmin("faqOrderUpdated"));
  }

  return (
    <div className="space-y-5 animate-rise-in max-w-4xl">
      {dialogs.element}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 text-lg">{tAdmin("faqTitle")}</h3>
          <p className="text-xs text-slate-500">
            {tAdmin("faqIntro")}
          </p>
        </div>
        <button type="button" onClick={startNew} className="gold-gradient text-[var(--navy)] text-sm font-bold px-4 py-2 rounded-xl">
          {tAdmin("faqAdd")}
        </button>
      </div>

      {message && <p role="status" className="text-sm text-slate-700 bg-slate-100 rounded-xl px-4 py-2.5">{message}</p>}

      {editingId !== null && (
        <form onSubmit={handleSave} className="bg-white border border-amber-300 rounded-2xl p-5 space-y-4 shadow-xs">
          <h4 className="font-bold text-slate-900">          {editingId === "new" ? tAdmin("faqNew") : tAdmin("faqEditTitle")}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
                        <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">{tAdmin("faqEnglishRequired")}</p>
              <div>
                          <label className={labelClass}>{tAdmin("faqQuestion")}</label>
                <input required maxLength={300} className={inputClass} value={form.question_en} onChange={(e) => setForm({ ...form, question_en: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>{tAdmin("faqAnswer")}</label>
                <textarea required rows={6} className={inputClass} value={form.answer_en} onChange={(e) => setForm({ ...form, answer_en: e.target.value })} />
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">              {tAdmin("faqFrenchOptional")}</p>
              <div>
                              <label className={labelClass}>{tAdmin("faqQuestion")}</label>
                <input maxLength={300} className={inputClass} value={form.question_fr} onChange={(e) => setForm({ ...form, question_fr: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>{tAdmin("faqAnswer")}</label>
                <textarea rows={6} className={inputClass} value={form.answer_fr} onChange={(e) => setForm({ ...form, answer_fr: e.target.value })} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
              {tAdmin("faqPublishedLabel")}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.show_on_homepage} onChange={(e) => setForm({ ...form, show_on_homepage: e.target.checked })} />
              {tAdmin("faqShowHome")}
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="bg-slate-900 text-white text-sm font-bold px-5 py-2 rounded-xl disabled:opacity-50">
              {busy ? tAdmin("faqSaving") : tAdmin("faqSave")}
            </button>
            <button type="button" onClick={() => setEditingId(null)} className="text-sm font-bold px-4 py-2 rounded-xl border border-slate-200 bg-white">
              {tAdmin("faqCancel")}
            </button>
          </div>
        </form>
      )}

      {state === "loading" ? (
        <p className="text-sm text-slate-400         py-6 text-center">{tAdmin("faqLoading")}</p>
      ) : state === "error" ? (
                <p className="text-sm text-rose-600 py-6 text-center">{tAdmin("faqLoadError")}</p>
      ) : faqs.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center bg-white rounded-2xl border border-slate-200">{tAdmin("faqEmpty")}</p>
      ) : (
        <ul className="space-y-2.5">
          {faqs.map((faq, index) => (
            <li key={faq.id} className="bg-white border border-slate-200/90 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <span className="text-[11px] font-black text-slate-400">#{index + 1}</span>
                  {!faq.is_published && <span className="text-[10px] font-bold uppercase bg-slate-200 text-slate-700                   px-2 py-0.5 rounded-full">{tAdmin("faqHiddenBadge")}</span>}
                                    {faq.is_published && !faq.show_on_homepage && <span className="text-[10px] font-bold uppercase bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full">{tAdmin("faqPageOnlyBadge")}</span>}
                  {faq.question_fr && <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">FR</span>}
                </div>
                <p className="font-bold text-slate-900 text-sm">{faq.question_en}</p>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{faq.answer_en}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0">
                <button type="button" className={smallBtn} disabled={busy || index === 0} onClick={() => move(index, -1)}                 aria-label={tAdmin("faqMoveUp")}>&uarr;</button>
                                <button type="button" className={smallBtn} disabled={busy || index === faqs.length - 1} onClick={() => move(index, 1)} aria-label={tAdmin("faqMoveDown")}>&darr;</button>
                <button
                  type="button"
                  className={smallBtn}
                  disabled={busy}
                                  onClick={() => run(() => updateAdminFaq(faq.id, { is_published: !faq.is_published }, token()), faq.is_published ? tAdmin("faqHiddenDone") : tAdmin("faqPublishedDone"))}
                >
                                  {faq.is_published ? tAdmin("faqHide") : tAdmin("faqPublish")}
                </button>
                                <button type="button" className={smallBtn} disabled={busy} onClick={() => startEdit(faq)}>{tAdmin("faqEditButton")}</button>
                <button
                  type="button"
                  className={`${smallBtn} !text-rose-700 !border-rose-200 hover:!bg-rose-50`}
                  disabled={busy}
                  onClick={async () => {
                    if (await dialogs.confirm(tAdmin("faqDeleteConfirm"), { destructive: true, confirmLabel: tAdmin("faqDeleteLabel") })) {
                      void run(() => deleteAdminFaq(faq.id, token()), tAdmin("faqDeleted"));
                    }
                  }}
                >
                  {tAdmin("faqDeleteLabel")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

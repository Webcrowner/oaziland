"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createManagedCourse, listManagedCourses, type ManageCourse } from "@/lib/api";
import { TRAINING_CATEGORIES } from "@/lib/trainingCategories";

export default function CourseManageList() {
  const t = useTranslations("CourseManage");
  const tc = useTranslations("TrainingPage");
  const router = useRouter();
  const [courses, setCourses] = useState<ManageCourse[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "OTHER", price: "", cert: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return setSignedIn(false);
    listManagedCourses(token).then((d) => setCourses(d.results)).catch(() => setCourses([]));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const course = await createManagedCourse(
        {
          title: form.title, description: form.description, category: form.category,
          price_xaf: form.price.trim() ? form.price.trim() : null, issues_certification: form.cert, is_published: false,
        },
        token,
      );
      router.push(`/trainings/manage/${course.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) return <p>{t("signIn")}</p>;
  if (!courses) return <p className="text-gray-500">…</p>;
  const isAdmin = courses.some((c) => c.my_role === "ADMIN");

  return (
    <div>
      {(isAdmin || courses.length === 0) && (
        <div className="mb-6">
          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="rounded-xl bg-[var(--navy)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#25396a]">+ {t("newCourse")}</button>
          ) : (
            <form onSubmit={create} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("courseTitle")} aria-label={t("courseTitle")} className="rounded border px-3 py-2 text-sm sm:col-span-2" />
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("description")} aria-label={t("description")} className="rounded border px-3 py-2 text-sm sm:col-span-2" rows={3} />
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label={t("category")} className="rounded border px-3 py-2 text-sm">
                {TRAINING_CATEGORIES.map((c) => <option key={c} value={c}>{tc(`categories.${c}`)}</option>)}
              </select>
              <input type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder={t("price")} aria-label={t("price")} className="rounded border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.cert} onChange={(e) => setForm({ ...form, cert: e.target.checked })} />{t("issuesCertificate")}</label>
              {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
              <div className="flex gap-2 sm:col-span-2">
                <button disabled={busy} className="rounded bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t("create")}</button>
                <button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2 text-sm">{t("cancel")}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {courses.length === 0 ? (
        <p className="text-gray-600">{t("none")}</p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <li key={c.id}>
              <Link href={`/trainings/manage/${c.id}`} className="block h-full rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-xl">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
                  <span className="rounded-full bg-[var(--navy)]/10 px-2.5 py-1 text-[var(--navy)]">{c.my_role ? t(`role_${c.my_role}`) : ""}</span>
                  <span className={`rounded-full px-2.5 py-1 ${c.is_published ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{c.is_published ? t("live") : t("draft")}</span>
                </div>
                <h2 className="font-[family-name:var(--font-display)] text-lg font-bold leading-snug text-slate-900">{c.title}</h2>
                <p className="mt-2 text-sm text-slate-500">👥 {t("learnersCount", { count: c.learner_count })}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

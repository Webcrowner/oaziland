"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { createManagedCourse, getCourseAccess, listManagedCourses, type CourseAccess, type ManageCourse } from "@/lib/api";
import { TRAINING_CATEGORIES } from "@/lib/trainingCategories";
import TrainerProfileEditor from "@/components/TrainerProfileEditor";

export default function CourseManageList() {
  const t = useTranslations("CourseManage");
  const tc = useTranslations("TrainingPage");
  const router = useRouter();
  const [courses, setCourses] = useState<ManageCourse[] | null>(null);
  const [access, setAccess] = useState<CourseAccess | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "OTHER", price: "", cert: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return setSignedIn(false);
    getCourseAccess(token).then(setAccess).catch(() => setAccess({ is_admin: false, can_create: false, can_publish: false, has_courses: false }));
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
  if (!courses || !access) return <p className="text-gray-500">…</p>;

  return (
    <div>
      <TrainerProfileEditor />
      {!access.can_create && courses.length === 0 && (
        <p className="mb-6 max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">🔒 {t("noCreatorAccess")}</p>
      )}
      {access.can_create && (
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
              {!access.can_publish && <p className="text-xs text-slate-500 sm:col-span-2">{t("reviewBeforePublishing")}</p>}
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
              <Link href={`/trainings/manage/${c.id}`} className="block h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-all hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-xl">
                {c.cover_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- uploads from arbitrary storage hosts
                  <img src={c.cover_image_url} alt="" loading="lazy" className="h-32 w-full object-cover" />
                )}
                <div className="p-5">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
                  <span className="rounded-full bg-[var(--navy)]/10 px-2.5 py-1 text-[var(--navy)]">{c.my_role ? t(`role_${c.my_role}`) : ""}</span>
                  <span className={`rounded-full px-2.5 py-1 ${c.is_published ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{c.is_published ? t("live") : c.review_requested_at ? t("awaitingReview") : t("draft")}</span>
                </div>
                <h2 className="font-[family-name:var(--font-display)] text-lg font-bold leading-snug text-slate-900">{c.title}</h2>
                {access.is_admin && <p className="mt-1 text-xs text-slate-500">{t("byProvider", { name: c.provider_name })}</p>}
                <p className="mt-2 text-sm text-slate-500">👥 {t("learnersCount", { count: c.learner_count })}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

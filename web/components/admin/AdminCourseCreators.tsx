"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  grantCourseCreator, listCourseCreators, revokeCourseCreator, updateCourseCreator, type CourseCreatorList,
} from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
}

const input = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none";
const smallButton =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-amber-400 hover:text-amber-700 disabled:opacity-40";

/** Admin console → Course creators: who may create their own courses, and the courses waiting to be reviewed. */
export default function AdminCourseCreators({ token, dialogs }: Props) {
  const t = useTranslations("CourseCreators");
  const [data, setData] = useState<CourseCreatorList | null>(null);
  const [failed, setFailed] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [canPublish, setCanPublish] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listCourseCreators(token));
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
      return true;
    } catch (error) {
      await dialogs.notify(error instanceof Error ? error.message : t("actionFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{t("loadFailed")}</p>;
  if (!data) return <p className="p-4 text-sm text-slate-500">…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">🧑‍🏫 {t("title")}</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{t("intro")}</p>
      </div>

      {data.awaiting_review.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="mb-2 font-bold text-amber-900">⏳ {t("awaitingReview", { count: data.awaiting_review.length })}</h3>
          <ul className="space-y-2">
            {data.awaiting_review.map((course) => (
              <li key={course.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm">
                <span className="flex-1">
                  <span className="font-semibold text-slate-900">{course.title}</span>{" "}
                  <span className="text-slate-500">· {course.provider.name} · {new Date(course.requested_at).toLocaleDateString()}</span>
                </span>
                <Link href={`/trainings/manage/${course.id}`} className={smallButton}>{t("review")}</Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">{t("reviewHint")}</p>
        </section>
      )}

      <form
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!identifier.trim()) return;
          if (await run(() => grantCourseCreator(identifier.trim(), canPublish, token))) setIdentifier("");
        }}
      >
        <label className="min-w-[16rem] flex-1 text-xs font-semibold text-slate-600">
          {t("identifier")}
          <input className={`${input} mt-1`} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={t("identifierPlaceholder")} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={canPublish} onChange={(e) => setCanPublish(e.target.checked)} />
          {t("canPublish")}
        </label>
        <button type="submit" disabled={busy || !identifier.trim()} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50">
          + {t("grant")}
        </button>
        <p className="basis-full text-xs text-slate-500">{t("grantHint")}</p>
      </form>

      {data.results.length === 0 ? (
        <p className="text-sm text-slate-500">{t("none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t("trainer")}</th>
                <th className="px-4 py-3">{t("courses")}</th>
                <th className="px-4 py-3">{t("publishing")}</th>
                <th className="px-4 py-3">{t("granted")}</th>
                <th className="px-4 py-3"><span className="sr-only">{t("actions")}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.results.map((grant) => (
                <tr key={grant.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{grant.user.name}</p>
                    <p className="text-xs text-slate-500">@{grant.user.username}{grant.user.phone ? ` · ${grant.user.phone}` : ""}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{t("courseCounts", { total: grant.course_count, live: grant.published_count })}</td>
                  <td className="px-4 py-3">
                    <label className="flex items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        checked={grant.can_publish}
                        disabled={busy}
                        onChange={(e) => run(() => updateCourseCreator(grant.id, e.target.checked, token))}
                      />
                      {grant.can_publish ? t("publishesDirectly") : t("adminReviews")}
                    </label>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(grant.granted_at).toLocaleDateString()}{grant.granted_by ? ` · ${grant.granted_by}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className={`${smallButton} hover:!border-red-300 hover:!text-red-600`}
                      disabled={busy}
                      onClick={async () => {
                        if (await dialogs.confirm(t("revokeConfirm", { name: grant.user.name }), { confirmLabel: t("revoke"), destructive: true })) {
                          run(() => revokeCourseCreator(grant.id, token));
                        }
                      }}
                    >
                      {t("revoke")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

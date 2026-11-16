"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoursePreview, type CoursePreviewLesson } from "@/lib/api";
import LessonText from "@/components/LessonText";
import LessonVideo from "@/components/LessonVideo";

/** The lessons a course offers for free, so a visitor can try it before enrolling or paying. */
export default function CoursePreview({ programId }: { programId: string }) {
  const t = useTranslations("CourseDetail");
  const [lessons, setLessons] = useState<CoursePreviewLesson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCoursePreview(programId)
      .then((rows) => { if (!cancelled) setLessons(rows); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [programId]);

  if (failed) return <p role="alert" className="text-sm text-red-600">{t("previewFailed")}</p>;
  if (!lessons) return <p className="text-sm text-slate-500">…</p>;
  if (lessons.length === 0) return null;

  return (
    <section id="preview" className="mb-10 scroll-mt-24">
      <h2 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold text-slate-900">{t("previewTitle")}</h2>
      <p className="mb-4 text-sm text-slate-500">{t("previewIntro")}</p>
      <ul className="space-y-3">
        {lessons.map((lesson) => {
          const open = openId === lesson.id;
          return (
            <li key={lesson.id} className="rounded-2xl border border-emerald-200 bg-white">
              <button
                type="button" onClick={() => setOpenId(open ? null : lesson.id)} aria-expanded={open}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">{t("previewBadge")}</span>
                <span className="flex-1">
                  <span className="block font-semibold text-slate-900">{lesson.title}</span>
                  <span className="block text-xs text-slate-500">{lesson.module_title}</span>
                </span>
                <span className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>›</span>
              </button>
              {open && (
                <div className="border-t border-slate-100 p-4">
                  {lesson.kind === "VIDEO" && (
                    <div className="mb-3 overflow-hidden rounded-xl">
                      <LessonVideo title={lesson.title} fileUrl={lesson.video_file_url} url={lesson.video_url} completed onEnded={() => undefined} />
                    </div>
                  )}
                  {lesson.kind === "PDF" && lesson.pdf_url && (
                    <a href={lesson.pdf_url} target="_blank" rel="noopener noreferrer" className="mb-3 inline-block font-semibold text-[var(--navy)] underline">📄 {t("previewOpenPdf")}</a>
                  )}
                  {lesson.content_text && <LessonText text={lesson.content_text} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getCourseAccess } from "@/lib/api";

/** Shown to admins, trainers given course-creator access, and people assigned to a course as lecturer/supervisor. */
export default function ManageCoursesLink() {
  const t = useTranslations("TrainingPage");
  const [show, setShow] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getCourseAccess(token)
      .then((access) => setShow(access.can_create || access.has_courses))
      .catch(() => setShow(false));
  }, []);

  if (!show) return null;
  return (
    <Link href="/trainings/manage" className="inline-flex items-center gap-2 rounded-xl border border-amber-300/60 bg-white/10 px-4 py-2.5 text-sm font-semibold text-amber-200 backdrop-blur transition hover:bg-white/20">
      ⚙️ {t("manageCourses")}
    </Link>
  );
}

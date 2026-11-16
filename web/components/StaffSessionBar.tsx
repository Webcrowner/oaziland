"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { STAFF_SESSION_EVENT, currentStaffSession, endStaffSession, type StaffSessionInfo } from "@/lib/api";

/** A bar on every page while someone works on another account: as staff for an owner, or as an admin for Oaziland itself. */
export default function StaffSessionBar() {
  const t = useTranslations("StaffAccess");
  const router = useRouter();
  const [session, setSession] = useState<StaffSessionInfo | null>(null);

  useEffect(() => {
    const sync = () => {
      const info = currentStaffSession();
      // An expired session hands the browser back to the staff member's own account.
      if (!info && localStorage.getItem("staff_session")) endStaffSession();
      setSession(info);
    };
    void Promise.resolve().then(sync);
    window.addEventListener(STAFF_SESSION_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(sync, 30_000);
    return () => {
      window.removeEventListener(STAFF_SESSION_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.clearInterval(timer);
    };
  }, []);

  if (!session) return null;
  const platform = session.kind === "platform";

  return (
    <div
      role="status"
      className={`sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-sm text-white shadow ${platform ? "bg-[var(--navy)]" : "bg-violet-700"}`}
    >
      {platform ? (
        <span>
          <span aria-hidden>🏢 </span>
          {t("barPlatform", { name: session.ownerName })}
          <span className="opacity-80"> · {t("barPlatformNote")}</span>
        </span>
      ) : (
        <span>
          <span aria-hidden>👥 </span>
          {t("barManaging", { name: session.ownerName })}
          {session.title && <span className="opacity-80"> · {session.title}</span>}
          <span className="opacity-80"> · {t("barLimited")}</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          endStaffSession();
          router.push(platform ? "/admin" : "/staff-access");
        }}
        className="rounded-lg bg-white/15 px-3 py-1 text-xs font-bold hover:bg-white/25 cursor-pointer"
      >
        {t("barBack")}
      </button>
    </div>
  );
}

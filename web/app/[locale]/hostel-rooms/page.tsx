"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import HostelRoomsManager from "@/components/HostelRoomsManager";

/** Where a student-hostel owner or manager runs their rooms. */
export default function HostelRoomsPage() {
  const t = useTranslations("HostelRooms");
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const stored = localStorage.getItem("access_token");
    void Promise.resolve().then(() => setToken(stored));
  }, []);

  return (
    <AccountSidebarLayout activeHref="/hostel-rooms">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {token === undefined ? null : token ? (
        <HostelRoomsManager token={token} />
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">{t("signInRequired")}</p>
          <Link href="/login" className="mt-3 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">{t("signIn")}</Link>
        </div>
      )}
    </AccountSidebarLayout>
  );
}

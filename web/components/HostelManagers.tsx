"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { HostelBoard } from "@/lib/api";

const field = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none";
const label = "flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500";

type Act = (action: string, body: Record<string, unknown>, success: string, after?: () => void) => Promise<void>;

/** Who runs this hostel besides its owner. The owner adds anyone (caretaker, relative, staff, agent) by phone or
 * username with full or bookings-only access, and removes them; managers see the list. */
export default function HostelManagers({ board, busy, act }: { board: HostelBoard; busy: boolean; act: Act }) {
  const t = useTranslations("HostelManagers");
  const [identifier, setIdentifier] = useState("");
  const [scope, setScope] = useState<"FULL" | "BOOKINGS_ONLY">("FULL");

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm" aria-labelledby="hostel-managers-heading">
      <div>
        <h3 id="hostel-managers-heading" className="text-sm font-bold text-slate-900">{t("title")}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">{t(board.is_owner ? "introOwner" : "introManager")}</p>
      </div>

      {board.listed_by && (
        <p className="text-xs text-slate-600">{t("listedBy", { name: board.listed_by.name })}</p>
      )}

      {board.managers.length === 0 ? (
        <p className="text-sm text-slate-500">{t("none")}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {board.managers.map((manager) => (
            <li key={manager.contract} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
              <div>
                <p className="font-semibold text-slate-900">{manager.name} <span className="text-xs font-normal text-slate-500">@{manager.username}</span></p>
                <p className="text-xs text-slate-500">
                  {t(`type_${manager.manager_type}`)} · {t(`scope_${manager.scope}`)}
                </p>
              </div>
              {manager.can_revoke && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("remove-manager", { contract: manager.contract }, t("removed", { name: manager.name }))}
                  className="text-xs font-bold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                >
                  {t("remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {board.is_owner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act("add-manager", { identifier, scope }, t("added"), () => setIdentifier(""));
          }}
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"
          aria-label={t("addTitle")}
        >
          <label className={`${label} min-w-[14rem] grow`}>
            {t("identifierLabel")}
            <input value={identifier} required maxLength={150} onChange={(e) => setIdentifier(e.target.value)} placeholder={t("identifierPlaceholder")} className={field} />
          </label>
          <label className={label}>
            {t("scopeLabel")}
            <select value={scope} onChange={(e) => setScope(e.target.value as "FULL" | "BOOKINGS_ONLY")} className={field}>
              <option value="FULL">{t("scope_FULL")}</option>
              <option value="BOOKINGS_ONLY">{t("scope_BOOKINGS_ONLY")}</option>
            </select>
          </label>
          <button type="submit" disabled={busy || !identifier.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {t("add")}
          </button>
        </form>
      )}
    </section>
  );
}

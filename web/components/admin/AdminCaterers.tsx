"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listAdminCaterers, setAdminCatererVerified, type AdminCaterer } from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
}

const STATES = ["pending", "verified", "all"] as const;

/** Caterers are curated by the team (they have no owner account), so this is where one is marked verified. */
export default function AdminCaterers({ token, dialogs }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [state, setState] = useState<(typeof STATES)[number]>("pending");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminCaterer[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminCaterers({ state, q: query, page }, token);
      setItems(data.results || []);
      setCount(data.count || 0);
      setHasNext(Boolean(data.next));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [state, query, page, token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function toggle(item: AdminCaterer) {
    const verify = !item.verified;
    if (!verify && !(await dialogs.confirm(t("catererUnverifyConfirm", { name: item.name }), { confirmLabel: t("catererUnverify"), destructive: true }))) return;
    setBusyId(item.id);
    try {
      const res = await setAdminCatererVerified(item.id, verify, token);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        await dialogs.notify(typeof body?.detail === "string" ? body.detail : t("actionFailed"));
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const pill = (active: boolean) =>
    `rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${active ? "bg-amber-500 text-slate-950" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("catererIntro")}</p>

      <div className="flex flex-wrap gap-2">
        {STATES.map((value) => (
          <button
            key={value}
            onClick={() => {
              setState(value);
              setPage(1);
            }}
            className={pill(state === value)}
          >
            {t(`catererState_${value}`)}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
        className="flex max-w-xl gap-2"
      >
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("catererSearchPlaceholder")}
          className="min-w-0 grow rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none"
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
          {t("auditApply")}
        </button>
      </form>

      <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("catererLoadError")}</p>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
          <p className="mt-1 text-xs text-slate-400">{t(`catererEmpty_${state}`)}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                  {item.name}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.verified ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {t(item.verified ? "catererVerified" : "catererNotVerified")}
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.cuisine_type || t("catererNoCuisine")} · {Number(item.price_per_head_min_xaf).toLocaleString()}–
                  {Number(item.price_per_head_max_xaf).toLocaleString()} XAF {t("catererPerHead")}
                  {item.rating !== null ? ` · ★ ${item.rating} (${item.review_count})` : ""}
                </p>
              </div>
              <button
                onClick={() => toggle(item)}
                disabled={busyId === item.id}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 ${item.verified ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
              >
                {t(item.verified ? "catererUnverify" : "catererVerify")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {count > 0 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("previous")}
          </button>
          <span className="text-xs font-medium text-slate-500">{t("pageN", { n: page })}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}

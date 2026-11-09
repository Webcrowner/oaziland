"use client";
import DataAdminLink, { dataAdminPath } from "@/components/admin/DataAdminLink";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  listAdminContent,
  removeAdminContent,
  restoreAdminContent,
  type AdminContentItem,
  type AdminContentState,
  type AdminContentType,
} from "@/lib/api";
import type { useAdminDialogs } from "@/components/admin/useAdminDialogs";

interface Props {
  token: string;
  dialogs: ReturnType<typeof useAdminDialogs>;
}

const TYPES: AdminContentType[] = ["marketplace", "property", "post"];
const STATES: AdminContentState[] = ["live", "removed"];

/** Browse what is published on the platform and pull an item down (or put it back), with a reason the owner is told. */
export default function AdminContentBrowser({ token, dialogs }: Props) {
  const t = useTranslations("AdminConsolePage");
  const [type, setType] = useState<AdminContentType>("marketplace");
  const [state, setState] = useState<AdminContentState>("live");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminContentItem[]>([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminContent({ type, state, q: query, page }, token);
      setItems(data.results || []);
      setCount(data.count || 0);
      setHasNext(Boolean(data.next));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [type, state, query, page, token]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function readError(res: Response) {
    const body = await res.json().catch(() => null);
    return typeof body?.detail === "string" ? body.detail : t("actionFailed");
  }

  async function handleRemove(item: AdminContentItem) {
    const reason = await dialogs.ask(t("contentRemovePrompt", { title: item.title }), {
      multiline: true,
      required: true,
      confirmLabel: t("contentRemove"),
      validate: (value) => (value.trim().length > 500 ? t("contentReasonTooLong") : null),
    });
    if (reason === null) return;
    setBusyId(item.id);
    try {
      const res = await removeAdminContent(item.type, item.id, reason.trim(), token);
      if (!res.ok) await dialogs.notify(await readError(res));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(item: AdminContentItem) {
    if (!(await dialogs.confirm(t("contentRestoreConfirm", { title: item.title }), { confirmLabel: t("contentRestore") }))) return;
    setBusyId(item.id);
    try {
      const res = await restoreAdminContent(item.type, item.id, token);
      if (!res.ok) await dialogs.notify(await readError(res));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const pill = (active: boolean) =>
    `rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`;

  const kindLabel = (item: AdminContentItem) => {
    const key = `contentKind_${item.kind}`;
    return item.kind && t.has(key) ? t(key) : item.kind;
  };
  const statusLabel = (item: AdminContentItem) => {
    const key = `contentStatus_${item.status}`;
    return t.has(key) ? t(key) : item.status;
  };

  return (
    <div className="space-y-4 animate-rise-in">
      <p className="max-w-3xl text-xs leading-relaxed text-slate-500">{t("contentIntro")}</p>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 pb-3">
        {TYPES.map((value) => (
          <button
            key={value}
            onClick={() => {
              setType(value);
              setPage(1);
            }}
            className={pill(type === value)}
          >
            {t(`contentType_${value}`)}
          </button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
        {STATES.map((value) => (
          <button
            key={value}
            onClick={() => {
              setState(value);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              state === value ? "bg-amber-500 text-slate-950" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t(`contentState_${value}`)}
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
          placeholder={t("contentSearchPlaceholder")}
          className="min-w-0 grow rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 focus:border-amber-500 focus:outline-none"
        />
        <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
          {t("auditApply")}
        </button>
      </form>

      <p className="text-xs font-semibold text-slate-500">{loading ? t("usersLoading") : t("contentCount", { count })}</p>

      {failed ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-rose-700">{t("contentLoadError")}</p>
        </div>
      ) : !loading && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-600">{t("noItems")}</p>
          <p className="mt-1 text-xs text-slate-400">{t(state === "removed" ? "contentEmptyRemoved" : "contentEmptyLive")}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 break-words text-sm font-bold text-slate-900">{item.title}</p>
                    {kindLabel(item) && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{kindLabel(item)}</span>
                    )}
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-800">{statusLabel(item)}</span>
                  </div>
                  {item.excerpt && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.excerpt}</p>}
                  <p className="mt-1.5 text-xs text-slate-500">
                    {t("contentBy")} <span className="font-semibold text-slate-700">{item.owner_name}</span> · @{item.owner_username}
                    {item.price_xaf ? <> · {Number(item.price_xaf).toLocaleString()} XAF</> : null} · {new Date(item.created_at).toLocaleDateString()}
                  </p>
                  <DataAdminLink
                    path={
                      item.type === "property"
                        ? dataAdminPath.propertyListing(item.id)
                        : item.type === "marketplace"
                          ? dataAdminPath.marketplaceListing(item.id)
                          : dataAdminPath.post(item.id)
                    }
                    className="mt-1"
                  />
                  {item.takedown && (
                    <p className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs text-rose-900">
                      <span className="font-bold">{t("contentRemovedBy", { name: item.takedown.removed_by || "—" })}:</span> {item.takedown.reason}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.path && !item.removed && (
                    <Link href={item.path} target="_blank" className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">
                      {t("contentOpen")}
                    </Link>
                  )}
                  {item.removed ? (
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={busyId === item.id}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {t("contentRestore")}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRemove(item)}
                      disabled={busyId === item.id}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {t("contentRemove")}
                    </button>
                  )}
                </div>
              </div>
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

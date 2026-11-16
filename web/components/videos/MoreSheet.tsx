"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { deletePost, type ReelPost } from "@/lib/api";
import ReportContentButton from "@/components/ReportContentButton";
import { IconX } from "@/components/Icons";

/** Report someone else's video, or delete your own. */
export default function MoreSheet({
  post, loggedIn, onClose, onDeleted,
}: {
  post: ReelPost;
  loggedIn: boolean;
  onClose: () => void;
  onDeleted: (postId: string) => void;
}) {
  const t = useTranslations("VideosPage");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleDelete() {
    const token = localStorage.getItem("access_token");
    if (!token || busy || !window.confirm(t("deleteVideoConfirm"))) return;
    setBusy(true);
    setFailed(false);
    try {
      await deletePost(post.id, token);
      onDeleted(post.id);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end md:items-center md:justify-center">
      <button type="button" aria-label={t("close")} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog" aria-modal="true" aria-label={t("moreTitle")}
        className="relative flex w-full flex-col rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-900 shadow-2xl animate-rise-in md:w-[24rem] md:rounded-3xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-extrabold">{t("moreTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <IconX size={16} />
          </button>
        </div>

        {post.is_mine ? (
          <>
            <button
              type="button" onClick={handleDelete} disabled={busy}
              className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              {t("deleteVideo")}
            </button>
            {failed && <p role="alert" className="mt-2 text-xs text-rose-600">{t("deleteFailed")}</p>}
          </>
        ) : loggedIn ? (
          <ReportContentButton kind="post" id={post.id} startOpen />
        ) : (
          <Link href="/login" className="text-sm font-bold underline">{t("signInToReport")}</Link>
        )}
      </div>
    </div>
  );
}

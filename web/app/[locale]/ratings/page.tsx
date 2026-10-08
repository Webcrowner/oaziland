"use client";
import { useState, useEffect, useCallback } from "react";
import { getMyRatings, type MyRatingsResult } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { IconStar } from "@/components/Icons";

export default function RatingsPage() {
  const [data, setData] = useState<MyRatingsResult | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  const load = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setStatus("signedOut");
      return;
    }
    getMyRatings(token)
      .then((result) => {
        setData(result);
        setStatus("ready");
      })
      .catch(() => setStatus("signedOut"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (status === "signedOut") {
    return (
      <AccountSidebarLayout activeHref="/ratings">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">Sign in to view your ratings.</p>
          <Button href="/login">Sign In</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  if (status === "loading" || !data) {
    return (
      <AccountSidebarLayout activeHref="/ratings">
        <div className="space-y-4">
          <div className="h-44 rounded-3xl bg-slate-100 animate-pulse" />
          <div className="h-40 rounded-3xl bg-slate-100 animate-pulse" />
        </div>
      </AccountSidebarLayout>
    );
  }

  const average = data.average_rating !== null ? Number(data.average_rating) : null;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: data.ratings_received.filter((r) => Math.min(5, Math.max(1, Math.round(Number(r.score)))) === star).length,
  }));
  const maxCount = Math.max(1, ...distribution.map((d) => d.count));
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <AccountSidebarLayout activeHref="/ratings">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
              <IconStar size={28} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Ratings &amp; Reviews</h1>
              <p className="mt-1 text-sm text-slate-400">
                The star ratings you&apos;ve received and given across the platform.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 md:gap-10 items-center">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-8 py-6 text-center">
              <p className="text-5xl font-black tracking-tight">{average !== null ? average.toFixed(1) : "—"}</p>
              <Stars value={average ?? 0} size={18} className="mt-2 justify-center" />
              <p className="mt-2 text-xs font-semibold text-slate-400">
                {data.rating_count} {data.rating_count === 1 ? "rating" : "ratings"} received
              </p>
            </div>
            <ul className="flex flex-col gap-2">
              {distribution.map((d) => (
                <li key={d.star} className="flex items-center gap-3 text-xs font-bold text-slate-300">
                  <span className="flex w-6 shrink-0 items-center gap-1">
                    {d.star}
                    <IconStar size={12} className="text-amber-400" />
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-amber-400" style={{ width: `${(d.count / maxCount) * 100}%` }} />
                  </span>
                  <span className="w-6 shrink-0 text-right text-slate-400">{d.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <section className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-black tracking-tight text-slate-900">Ratings Received</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{data.ratings_received.length}</span>
          </div>
          {data.ratings_received.length === 0 ? (
            <EmptyState icon={<IconStar size={28} />} title="No ratings received yet." description="Ratings from people you work with will show up here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.ratings_received.map((r) => (
                <RatingRow key={r.id} name={r.author_name || "A platform user"} date={formatDate(r.created_at)} score={Number(r.score)} />
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-black tracking-tight text-slate-900">Ratings You&apos;ve Given</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{data.ratings_given.length}</span>
          </div>
          {data.ratings_given.length === 0 ? (
            <EmptyState icon={<IconStar size={28} />} title="You haven't rated anyone yet." description="After a booking, rate your host or provider to help others." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.ratings_given.map((r) => (
                <RatingRow key={r.id} name={r.subject_user ? "Platform user" : "Property"} date={formatDate(r.created_at)} score={Number(r.score)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </AccountSidebarLayout>
  );
}

function Stars({ value, size = 14, className = "" }: { value: number; size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-0.5 ${className}`} aria-label={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} size={size} className={i <= Math.round(value) ? "text-amber-400" : "text-slate-500/40"} />
      ))}
    </span>
  );
}

function RatingRow({ name, date, score }: { name: string; date: string; score: number }) {
  return (
    <li className="flex items-center gap-3.5 py-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-black text-amber-300">
        {(name.charAt(0) || "?").toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-900">{name}</p>
        <p className="text-xs text-slate-400">{date}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Stars value={score} />
        <span className="text-xs font-black text-slate-700">{score.toFixed(1)}</span>
      </div>
    </li>
  );
}

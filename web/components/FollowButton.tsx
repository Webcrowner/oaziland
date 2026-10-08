"use client";
import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { getFollowStatus, toggleFollow, type FollowStatus } from "@/lib/api";

/**
 * A real one-tap Follow/Unfollow button — UC13 in docs/01's use-case
 * diagram had follow_user/unfollow_user/toggle_follow fully built and
 * tested, but no profile anywhere could actually show one.
 */
export default function FollowButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<FollowStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getFollowStatus(userId, token).then(setStatus).catch(() => {});
  }, [userId]);

  async function handleToggle() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    setBusy(true);
    try {
      const updated = await toggleFollow(userId, token);
      setStatus(updated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        disabled={busy}
        className={`text-xs font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${
          status?.is_following ? "bg-gray-100 text-gray-700 hover:bg-gray-200" : "bg-[var(--navy)] text-white hover:opacity-90"
        }`}
      >
        {status?.is_following ? "Following" : "Follow"}
      </button>
      {status?.is_mutual && <span className="text-[11px] text-gray-500">Follows you</span>}
      {status && (
        <span className="text-[11px] text-gray-400">
          {status.follower_count} follower{status.follower_count === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

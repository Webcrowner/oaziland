"use client";
import { useEffect, useState } from "react";
import { getMyProfile } from "@/lib/api";

let lookup: { token: string; id: Promise<string | null> } | null = null;

/** The signed-in user's id (looked up once per token and shared), or null when signed out or the lookup fails. */
function currentUserId(token: string): Promise<string | null> {
  if (!lookup || lookup.token !== token) lookup = { token, id: getMyProfile(token).then((profile) => profile.id).catch(() => null) };
  return lookup.id;
}

/**
 * Renders its children for everyone except the person who owns the listing, who has no use for "message the
 * seller", "rate this person", "report this listing" or "save" on their own item. Visitors see the children
 * immediately (and in the server-rendered page); an owner's copy disappears as soon as we know who they are.
 */
export default function HideForOwner({ ownerId, children }: { ownerId?: string; children: React.ReactNode }) {
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !ownerId) return;
    let stale = false;
    currentUserId(token).then((id) => { if (!stale) setIsOwner(id === ownerId); });
    return () => { stale = true; };
  }, [ownerId]);

  return isOwner ? null : <>{children}</>;
}

"use client";
import { useState, useEffect, useCallback } from "react";
import { grantParentAccess, revokeParentAccess, getMyParentAccessGrants, type ParentAccessGrantItem } from "@/lib/api";

/**
 * Student-side management of ParentGuardianAccess grants — the real
 * gap this closes: the model could only ever be created directly in
 * the database; a student had no way to grant or revoke a parent's
 * read-only visibility onto their billing/welfare status.
 */
export default function ParentAccessManager() {
  const [grants, setGrants] = useState<ParentAccessGrantItem[]>([]);
  const [parentUserId, setParentUserId] = useState("");
  const [notifyInstitution, setNotifyInstitution] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getMyParentAccessGrants(token).then((data) => setGrants(data.filter((g) => !g.revoked_at))).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token || !parentUserId) return;
    setStatus("submitting");
    try {
      const grant = await grantParentAccess(parentUserId, notifyInstitution, token);
      setGrants((prev) => [grant, ...prev]);
      setParentUserId("");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function handleRevoke(grantId: string) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    await revokeParentAccess(grantId, token);
    setGrants((prev) => prev.filter((g) => g.id !== grantId));
  }  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-[var(--navy)] mb-3 border-b pb-2">Parent/Guardian Access</h2>
      <form onSubmit={handleGrant} className="border border-gray-200 rounded-xl p-4 bg-white flex flex-wrap items-center gap-2 mb-3">
        <input
          placeholder="Parent user ID" value={parentUserId} onChange={(e) => setParentUserId(e.target.value)}
          className="flex-1 min-w-[180px] border rounded-lg px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" checked={notifyInstitution} onChange={(e) => setNotifyInstitution(e.target.checked)} />
          Also notify institution
        </label>
        <button disabled={status === "submitting"} className="bg-[var(--navy)] text-white text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
          {status === "submitting" ? "Granting..." : "Grant Access"}
        </button>
      </form>
      {status === "error" && <p className="text-red-600 text-xs mb-2">Could not grant access — check the user ID.</p>}
      {grants.length > 0 && (
        <div className="flex flex-col gap-2">
          {grants.map((grant) => (
            <div key={grant.id} className="flex items-center justify-between border rounded-lg p-3 bg-white text-xs">
              <span>{grant.parent_name || grant.parent_user}</span>
              <button onClick={() => handleRevoke(grant.id)} className="text-red-600 font-semibold hover:underline">Revoke</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

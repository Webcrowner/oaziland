"use client";
import { useState, useEffect, useCallback } from "react";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import { getMyGuardianAccesses, getParentPortalData, type ParentAccessGrantItem, type ParentPortalData } from "@/lib/api";

/**
 * The real gap this closes: get_parent_visible_data() (a strict,
 * consent-gated, billing+welfare-status-ONLY view) was fully built
 * and tested, but no page ever let a real parent account see it.
 * Now lists the real students who granted access — no need to already
 * know a raw student user ID.
 */
export default function ParentPortalPage() {
  const [grants, setGrants] = useState<ParentAccessGrantItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [manualStudentId, setManualStudentId] = useState("");
  const [data, setData] = useState<ParentPortalData | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("idle");
      return;
    }
    getMyGuardianAccesses(token)
      .then((data) => setGrants(data))
      .catch(() => {})
      .finally(() => setStatus("idle"));
  }, []);

  const loadStudentData = useCallback((studentId: string) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setSelectedStudentId(studentId);
    setError("");
    setData(null);
    getParentPortalData(studentId, token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load this student's data."));
  }, []);

  function handleManualLookup(e: React.FormEvent) {
    e.preventDefault();
    if (manualStudentId) loadStudentData(manualStudentId);
  }

  return (
    <AccountSidebarLayout activeHref="/parent-portal">
      <PageHeader
        title="Parent / Guardian Portal"
        subtitle="Consent-gated, read-only view onto your student's billing and welfare status — never maintenance requests or disciplinary notes."
      />

      {status === "loading" ? (
        <p className="text-slate-400 text-sm">Loading...</p>
      ) : grants.length > 0 ? (
        <div className="flex flex-wrap gap-2 mb-6">
          {grants.map((grant) => (
            <button
              key={grant.id}
              onClick={() => loadStudentData(grant.student)}
              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${
                selectedStudentId === grant.student ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {grant.student_name || grant.student}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="No student has granted you access yet." />
      )}

      <form onSubmit={handleManualLookup} className="border border-slate-200/90 rounded-2xl p-4 bg-white flex flex-wrap gap-2 mb-6">
        <input
          placeholder="Or enter a student user ID directly" value={manualStudentId} onChange={(e) => setManualStudentId(e.target.value)}
          className="flex-1 min-w-[200px] border rounded-xl px-3 py-2 text-xs"
        />
        <button className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700">Look Up</button>
      </form>

      {error && <p className="text-rose-600 text-sm mb-4">{error}</p>}

      {data && (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Welfare Status</span>
            <span className={`text-xs font-black px-2 py-0.5 rounded-full ${data.welfare_status === "HAS_OPEN_ALERT" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>
              {data.welfare_status === "HAS_OPEN_ALERT" ? "Open Alert" : "No Open Alerts"}
            </span>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Bills</p>
            {data.bills.length === 0 ? (
              <p className="text-xs text-slate-400">No bills on record.</p>
            ) : (
              <div className="space-y-1">
                {data.bills.map((bill) => (
                  <p key={bill.id} className="text-xs text-slate-700">
                    {Number(bill.amount_xaf).toLocaleString()} XAF — due {bill.due_date} — {bill.status}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </AccountSidebarLayout>
  );
}

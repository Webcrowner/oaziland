"use client";
import { useState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { joinHostelWaitlist, listHostelSemesters, type HostelSemesterItem } from "@/lib/api";

const UNIT_TYPES = [
  { value: "SHARED_ROOM", label: "Shared Room" },
  { value: "SELF_CONTAIN", label: "Self-Contain" },
  { value: "STUDIO", label: "Studio" },
  { value: "ONE_BED_APARTMENT", label: "One-Bed Apartment" },
];

/**
 * Prompt 11's "join a waitlist, get auto-notified or auto-allocated
 * when a matching unit frees up" — join_hostel_waitlist() was fully
 * built and tested, but nothing let a real student reach it. Real
 * semesters for THIS hostel's partner institution(s) are fetched and
 * offered as a dropdown, closing the earlier raw-semester-ID gap.
 */
export default function JoinHostelWaitlistButton({ hostelId }: { hostelId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unitType, setUnitType] = useState(UNIT_TYPES[0].value);
  const [semesters, setSemesters] = useState<HostelSemesterItem[]>([]);
  const [semesterId, setSemesterId] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "joined" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    listHostelSemesters(hostelId)
      .then((data) => {
        setSemesters(data);
        if (data.length > 0) setSemesterId(String(data[0].id));
      })
      .catch(() => {});
  }, [open, hostelId]);

  async function handleJoin() {
    const token = localStorage.getItem("access_token");
    if (!token) {
      router.push("/login");
      return;
    }
    if (!semesterId) return;
    setStatus("submitting");
    try {
      await joinHostelWaitlist({ hostel: hostelId, desired_unit_type: unitType, semester: Number(semesterId) }, token);
      setStatus("joined");
    } catch {
      setStatus("error");
    }
  }

  if (status === "joined") {
    return <p className="text-[11px] font-semibold text-emerald-700">✓ On the waitlist — you'll be notified.</p>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] font-bold text-slate-500 underline">
        Join Waitlist Instead
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 mt-1">
      <div className="flex gap-1.5">
        <select value={unitType} onChange={(e) => setUnitType(e.target.value)} className="flex-1 border rounded-lg px-2 py-1 text-[11px]">
          {UNIT_TYPES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
        {semesters.length > 0 ? (
          <select value={semesterId} onChange={(e) => setSemesterId(e.target.value)} className="flex-1 border rounded-lg px-2 py-1 text-[11px]">
            {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : (
          <input
            type="number" placeholder="Semester ID" value={semesterId} onChange={(e) => setSemesterId(e.target.value)}
            className="w-24 border rounded-lg px-2 py-1 text-[11px]"
          />
        )}
      </div>
      {status === "error" && <p className="text-[10px] text-red-600">Could not join — check the semester ID.</p>}
      <button
        onClick={handleJoin}
        disabled={status === "submitting" || !semesterId}
        className="text-[11px] font-bold bg-slate-900 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
      >
        {status === "submitting" ? "Joining..." : "Confirm Waitlist"}
      </button>
    </div>
  );
}

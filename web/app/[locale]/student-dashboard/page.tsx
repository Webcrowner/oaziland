"use client";
import { useState, useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { listMyRoomAllocations, listMyBookings, type MyRoomAllocationItem, type BookingItem } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  IconGraduationCap,
  IconBuilding,
  IconCheckCircle,
  IconClock,
  IconMapPin,
  IconCreditCard,
  IconChevronRight,
  IconShieldCheck,
} from "@/components/Icons";
import Button from "@/components/ui/Button";

export default function StudentDashboardPage() {
  const [allocations, setAllocations] = useState<MyRoomAllocationItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      setStatus("signedOut");
      return;
    }

    Promise.all([
      listMyRoomAllocations(token).catch(() => ({ results: [] })),
      listMyBookings(token).catch(() => ({ results: [] })),
    ])
      .then(([allocRes, bookRes]) => {
        setAllocations(allocRes.results || []);
        // Filter hostel related bookings
        setBookings(bookRes.results || []);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  if (status === "signedOut") {
    return (
      <DashboardLayout
        currentRole="student"
        activeHref="/student-dashboard"
        title="Student Housing Dashboard"
        subtitle="Manage your university accommodation, room allocations, and verified hostel stays."
      >
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">Please sign in to view your Student Housing Dashboard.</p>
          <Button href="/login">Sign In</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading") {
    return (
      <DashboardLayout
        currentRole="student"
        activeHref="/student-dashboard"
        title="Student Housing Dashboard"
      >
        <div className="text-center py-20 text-slate-400">Loading student dashboard...</div>
      </DashboardLayout>
    );
  }

  const activeAlloc = allocations.find((a) => a.status === "ACTIVE" || a.status === "CONFIRMED");

  return (
    <DashboardLayout
      currentRole="student"
      activeHref="/student-dashboard"
      title="Student Housing Dashboard"
      subtitle="Track your verified university hostel room allocations, semester terms, and rent escrow deposits."
      badge={activeAlloc ? "Room Allocated" : "Resident"}
      action={
        <Link
          href="/student-hostels"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
        >
          <span>Find University Hostels</span>
          <IconChevronRight size={14} />
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Active Accommodation Banner */}
        {activeAlloc ? (
          <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-950 text-white shadow-xl space-y-3 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
                Active Assignment
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Semester: <strong className="text-white">{activeAlloc.semester}</strong>
              </span>
            </div>
            <div>
              <h3 className="text-lg font-black text-white">
                Bed Slot {activeAlloc.bed_slot} • Unit {activeAlloc.unit}
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Allocated on {new Date(activeAlloc.allocated_at).toLocaleDateString()}
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Status: <strong className="text-amber-400">{activeAlloc.status}</strong></span>
              <span className="text-slate-400">Zero duplicate room allocations enforced</span>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900">No Active Room Allocation Yet</h3>
              <p className="text-xs text-slate-500">
                Explore verified student hostels near your campus in Buea, Yaoundé, Dschang, Douala or Bambili.
              </p>
            </div>
            <Button href="/student-hostels">Browse Campus Hostels</Button>
          </div>
        )}

        {/* Quick Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">Room Allocations</p>
            <p className="text-2xl font-black text-slate-900">{allocations.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">Total recorded slots</p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">Platform Escrow Stays</p>
            <p className="text-2xl font-black text-indigo-600">{bookings.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">Secured payments with refund protection</p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs">
            <p className="text-xs font-semibold text-slate-500 mb-1">Campus Safety &amp; Welfare</p>
            <p className="text-2xl font-black text-emerald-600">Active</p>
            <p className="text-[11px] text-slate-400 mt-1">24/7 emergency welfare escalation</p>
          </div>
        </div>

        {/* Room Allocations Log */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Allocation Records</h3>
              <p className="text-xs text-slate-500">History of authorized room assignments</p>
            </div>
          </div>

          {allocations.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No historical allocations found. Once a hostel administrator assigns you a room slot, it will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {allocations.map((alloc) => (
                <div
                  key={alloc.id}
                  className="p-4 rounded-2xl border border-slate-200/80 hover:border-slate-300 transition-colors flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        Slot {alloc.bed_slot}
                      </span>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                        {alloc.status}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-800">
                      Unit ID: {alloc.unit} • Semester {alloc.semester}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(alloc.allocated_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Bookings & Escrow Receipts */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Payment &amp; Escrow Receipts</h3>
              <p className="text-xs text-slate-500">Security deposits held in escrow</p>
            </div>
            <Link href="/bookings" className="text-xs font-bold text-slate-600 hover:text-slate-900 underline">
              View All Bookings →
            </Link>
          </div>

          {bookings.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No active escrow payments on file.
            </div>
          ) : (
            <div className="space-y-3">
              {bookings.slice(0, 5).map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-2xl border border-slate-200/80 flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {b.status}
                    </span>
                    <p className="text-xs font-bold text-slate-800 pt-1">
                      Booking Reference #{b.id.slice(0, 8)}
                    </p>
                  </div>
                  <span className="text-xs font-black text-slate-900">
                    {Number(b.amount_xaf || 0).toLocaleString()} XAF
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

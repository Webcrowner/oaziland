"use client";
import { useState, useEffect } from "react";
import { Link } from "@/i18n/navigation";
import { listMyBookings, type BookingItem } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  IconCompass,
  IconBuilding,
  IconCheckCircle,
  IconClock,
  IconCreditCard,
  IconChevronRight,
  IconShieldCheck,
  IconMapPin,
} from "@/components/Icons";
import Button from "@/components/ui/Button";

export default function RenterDashboardPage() {
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      void Promise.resolve().then(() => setStatus("signedOut"));
      return;
    }

    listMyBookings(token)
      .then((res) => {
        setBookings(res.results || []);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  if (status === "signedOut") {
    return (
      <DashboardLayout
        currentRole="renter"
        activeHref="/renter-dashboard"
        title="Renter & Buyer Dashboard"
        subtitle="Manage your escrow deposits, viewings, and saved property searches."
      >
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">Please sign in to view your Renter Dashboard.</p>
          <Button href="/login">Sign In</Button>
        </div>
      </DashboardLayout>
    );
  }

  if (status === "loading") {
    return (
      <DashboardLayout
        currentRole="renter"
        activeHref="/renter-dashboard"
        title="Renter & Buyer Dashboard"
      >
        <div className="text-center py-20 text-slate-400">Loading your seeker dashboard...</div>
      </DashboardLayout>
    );
  }

  const activeEscrow = bookings.filter((b) => b.status === "PENDING" || b.status === "CONFIRMED");
  const completedStays = bookings.filter((b) => b.status === "COMPLETED");
  const totalHeldEscrow = activeEscrow.reduce((acc, b) => acc + Number(b.amount_xaf || 0), 0);

  return (
    <DashboardLayout
      currentRole="renter"
      activeHref="/renter-dashboard"
      title="Renter & Buyer Dashboard"
      subtitle="Track your verified rental bookings, active escrow protection, and saved favorite homes."
      badge="Verified Seeker"
      action={
        <Link
          href="/search"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm"
        >
          <span>Find Homes &amp; Plots</span>
          <IconChevronRight size={14} />
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Active Escrow Protection Banner */}
        <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 text-white shadow-xl relative overflow-hidden space-y-3">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-400/10 rounded-full blur-3xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300">
              <IconShieldCheck size={14} />
              <span>Full Escrow Protection</span>
            </span>
            <span className="text-xs text-slate-400">Cameroon Civil Code Compliant</span>
          </div>

          <div>
            <p className="text-xs text-slate-400 uppercase font-semibold">Funds Currently Secured in Escrow</p>
            <p className="text-3xl font-black text-amber-400 mt-0.5">
              {totalHeldEscrow.toLocaleString()} <span className="text-sm font-normal text-slate-400">XAF</span>
            </p>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed pt-1">
            Your rental deposits are retained in platform escrow until you inspect the property and approve release.
          </p>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link href="/bookings?filter=active" className="group p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs hover:border-slate-400 hover:shadow-md transition-all">
            <p className="text-xs font-semibold text-slate-500 mb-1">Active Bookings</p>
            <p className="text-2xl font-black text-slate-900">{activeEscrow.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">Pending inspection / check-in</p>
            <p className="text-[11px] font-bold text-amber-600 mt-2 group-hover:underline">View bookings →</p>
          </Link>

          <Link href="/bookings?filter=completed" className="group p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs hover:border-slate-400 hover:shadow-md transition-all">
            <p className="text-xs font-semibold text-slate-500 mb-1">Completed Leases</p>
            <p className="text-2xl font-black text-emerald-600">{completedStays.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">Released to property owners</p>
            <p className="text-[11px] font-bold text-amber-600 mt-2 group-hover:underline">View bookings →</p>
          </Link>

          <Link href="/bookings" className="group p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs hover:border-slate-400 hover:shadow-md transition-all">
            <p className="text-xs font-semibold text-slate-500 mb-1">Total History</p>
            <p className="text-2xl font-black text-indigo-600">{bookings.length}</p>
            <p className="text-[11px] text-slate-400 mt-1">Total verified transactions</p>
            <p className="text-[11px] font-bold text-amber-600 mt-2 group-hover:underline">View bookings →</p>
          </Link>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/favorites"
            className="p-5 rounded-3xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all flex items-center justify-between group shadow-xs"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Saved</p>
              <h4 className="text-sm font-black text-slate-900 mt-0.5">Favorite Properties</h4>
              <p className="text-[11px] text-slate-500">Shortlisted homes and shops for quick review</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-slate-900 group-hover:text-white transition-colors">
              <IconChevronRight size={14} />
            </div>
          </Link>

          <Link
            href="/saved-searches"
            className="p-5 rounded-3xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all flex items-center justify-between group shadow-xs"
          >
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Alerts</p>
              <h4 className="text-sm font-black text-slate-900 mt-0.5">Saved Searches &amp; Alerts</h4>
              <p className="text-[11px] text-slate-500">Instant WhatsApp &amp; SMS alerts on new listings</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-slate-900 group-hover:text-white transition-colors">
              <IconChevronRight size={14} />
            </div>
          </Link>
        </div>

        {/* Recent Bookings Queue */}
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Your Booking Ledger</h3>
              <p className="text-xs text-slate-500">Property deposits and reservation timeline</p>
            </div>
            <Link href="/bookings" className="text-xs font-bold text-slate-600 hover:text-slate-900 underline">
              View Details →
            </Link>
          </div>

          {bookings.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs">
              No property bookings yet. Search for rentals or sale properties to reserve securely.
            </div>
          ) : (
            <div className="space-y-3">
              {bookings.slice(0, 6).map((b) => (
                <div
                  key={b.id}
                  className="p-4 rounded-2xl border border-slate-200/80 hover:border-slate-300 transition-colors flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {b.status}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(b.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-900">
                      Booking Reference #{b.id.slice(0, 8)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-900">
                      {Number(b.amount_xaf || 0).toLocaleString()} XAF
                    </p>
                    <p className="text-[10px] text-emerald-600 font-bold">Escrow Verified</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

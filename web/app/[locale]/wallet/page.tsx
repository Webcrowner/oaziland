"use client";
import { useEffect, useState } from "react";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import Button from "@/components/ui/Button";
import WalletPayoutCard from "@/components/WalletPayoutCard";
import RechargeAndGiftsCard from "@/components/RechargeAndGiftsCard";
import { IconCreditCard } from "@/components/Icons";

/**
 * Standalone Wallet & Transactions hub — previously MISSING entirely:
 * WalletPayoutCard only ever existed embedded inside the technician/
 * driver/landlord dashboards, yet every account sidebar and the renter/
 * agent/student dashboards already linked to /wallet, which 404'd.
 * This is the one real page any signed-in user (renter, agent, student,
 * landlord, driver, technician) lands on for balance, MoMo/Orange Money
 * withdrawal, and transaction history.
 */
export default function WalletPage() {
  const [loggedIn, setLoggedIn] = useState(true);
  const [walletVersion, setWalletVersion] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    setLoggedIn(!!token);
  }, []);

  if (!loggedIn) {
    return (
      <AccountSidebarLayout activeHref="/wallet">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-slate-600 mb-4 font-semibold text-sm">Sign in to view your wallet.</p>
          <Button href="/login">Sign In</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  return (
    <AccountSidebarLayout activeHref="/wallet">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="relative p-6 sm:p-8 flex items-center gap-5">
          <div className="flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/25">
            <IconCreditCard size={28} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Wallet &amp; Transactions</h1>
            <p className="mt-1 text-sm text-slate-400">
              Your cleared balance from completed bookings, rides and services — withdraw to MTN MoMo or Orange Money.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2">
          <WalletPayoutCard key={walletVersion} />
        </div>
        <RechargeAndGiftsCard onWalletChanged={() => setWalletVersion((v) => v + 1)} />
      </div>
    </AccountSidebarLayout>
  );
}

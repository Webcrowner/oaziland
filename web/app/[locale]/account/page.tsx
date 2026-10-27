"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getMyProfile, updateMyProfile, getMyBadges, uploadMediaFile, type UserProfile, type MyBadgeItem } from "@/lib/api";
import AccountSidebarLayout from "@/components/AccountSidebarLayout";
import Avatar from "@/components/Avatar";
import ParentAccessManager from "@/components/ParentAccessManager";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import Button from "@/components/ui/Button";
import {
  IconQrCode,
  IconShare,
  IconArrowUpRight,
  IconChevronRight,
  IconUpload,
  IconTrash,
  IconShieldCheck,
  IconLock,
  IconCompass,
  IconBuilding,
  IconDashboard,
  IconGraduationCap,
  IconCar,
  IconWrench,
  IconHome,
  IconUsers,
  IconGift,
  IconSparkles,
  IconFileText,
  IconMessageCircle,
  IconBell,
  IconHeart,
  IconSearch,
  IconHotel,
  IconParty,
  IconBriefcase,
  IconEyeOff,
  IconStar,
  IconCheckCircle,
  IconAlertCircle,
} from "@/components/Icons";

type LinkIcon = React.ComponentType<{ size?: number; className?: string }>;
interface HubLink {
  href: string;
  label: string;
  icon: LinkIcon;
}
interface HubGroup {
  title: string;
  description: string;
  links: HubLink[];
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:bg-white focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-400/15";

const VERIFICATION_STYLES: Record<string, { label: string; className: string; verified: boolean }> = {
  VERIFIED: { label: "Verified", className: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30", verified: true },
  PENDING: { label: "Pending review", className: "bg-amber-400/15 text-amber-200 border-amber-300/30", verified: false },
  REJECTED: { label: "Rejected", className: "bg-red-500/15 text-red-300 border-red-400/30", verified: false },
  UNVERIFIED: { label: "Not verified", className: "bg-white/10 text-slate-300 border-white/15", verified: false },
};

/**
 * Account hub — previously PARTIAL: profile/password/KYC/referrals were
 * either scattered across separate top-level routes or missing entirely
 * (no profile editor, no password/security page, no KYC status page).
 * This is the one real, central place a user manages their account,
 * linking out to every real sub-page rather than duplicating them.
 */
export default function AccountPage() {
  const t = useTranslations("AccountPage");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "signedOut" | "ready">("loading");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [badges, setBadges] = useState<MyBadgeItem[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<"idle" | "uploading">("idle");
  const [photoError, setPhotoError] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      setStatus("signedOut");
      return;
    }
    getMyProfile(token)
      .then((data) => {
        setProfile(data);
        setUsername(data.username);
        setPhone(data.phone);
        setEmail(data.email || "");
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
    getMyBadges(token).then((data) => setBadges(data.results)).catch(() => {});
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setError("");
    setSaveStatus("saving");
    try {
      const updated = await updateMyProfile({ username, phone, email }, token);
      setProfile(updated);
      setSaveStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
      setSaveStatus("error");
    }
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (photoInputRef.current) photoInputRef.current.value = "";
    const token = localStorage.getItem("access_token");
    if (!file || !token) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file.");
      return;
    }
    setPhotoError("");
    setPhotoStatus("uploading");
    try {
      const { url } = await uploadMediaFile(file, "avatars", token);
      setProfile(await updateMyProfile({ profile_image_url: url }, token));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not upload photo");
    } finally {
      setPhotoStatus("idle");
    }
  }

  async function handleRemovePhoto() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setPhotoError("");
    try {
      setProfile(await updateMyProfile({ profile_image_url: "" }, token));
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not remove photo");
    }
  }

  if (status === "signedOut") {
    return (
      <AccountSidebarLayout activeHref="/account">
        <div className="bg-white border border-slate-200/90 rounded-3xl p-8 text-center max-w-md mx-auto">
          <p className="text-gray-600 mb-4">{t("signInRequired")}</p>
          <Button href="/login">{t("signInRequired")}</Button>
        </div>
      </AccountSidebarLayout>
    );
  }

  if (status === "loading" || !profile) {
    return (
      <AccountSidebarLayout activeHref="/account">
        <div className="text-center py-20 text-gray-400">...</div>
      </AccountSidebarLayout>
    );
  }

  const groups: HubGroup[] = [
    {
      title: "My Dashboards",
      description: "Role-based hubs for everything you do on the platform.",
      links: [
        { href: "/renter-dashboard", label: "Renter & Seeker Hub", icon: IconCompass },
        { href: "/landlord-portfolio", label: t("linkLandlordPortfolio"), icon: IconDashboard },
        { href: "/dashboard", label: "Agent Performance Hub", icon: IconBriefcase },
        { href: "/agency-dashboard", label: t("linkAgencyDashboard"), icon: IconBuilding },
        { href: "/student-dashboard", label: "Student Housing Hub", icon: IconGraduationCap },
        { href: "/driver-dashboard", label: "OaziGo Driver Hub", icon: IconCar },
        { href: "/technician-dashboard", label: t("linkTechnicianDashboard"), icon: IconWrench },
        { href: "/property-management", label: t("linkPropertyManagement"), icon: IconHome },
        { href: "/hotel-dashboard", label: t("linkHotelDashboard"), icon: IconHotel },
        { href: "/venue-dashboard", label: t("linkVenueDashboard"), icon: IconParty },
        { href: "/host-dashboard", label: t("linkHostDashboard"), icon: IconHome },
        { href: "/parent-portal", label: "Parent/Guardian Portal", icon: IconUsers },
      ],
    },
    {
      title: "Security & Privacy",
      description: "Protect your account and control what others can see.",
      links: [
        { href: "/security", label: t("linkSecurity"), icon: IconLock },
        { href: "/kyc", label: t("linkKyc"), icon: IconShieldCheck },
        { href: "/privacy-settings", label: t("linkPrivacy"), icon: IconEyeOff },
      ],
    },
    {
      title: "Activity & Discovery",
      description: "Your bookings, conversations and saved items.",
      links: [
        { href: "/bookings", label: t("linkBookings"), icon: IconFileText },
        { href: "/messages", label: t("linkMessages"), icon: IconMessageCircle },
        { href: "/notifications", label: t("linkNotifications"), icon: IconBell },
        { href: "/favorites", label: t("linkFavorites"), icon: IconHeart },
        { href: "/saved-searches", label: t("linkSavedSearches"), icon: IconSearch },
      ],
    },
    {
      title: "Growth & Rewards",
      description: "Invite friends and unlock premium features.",
      links: [
        { href: "/referrals", label: t("linkReferrals"), icon: IconGift },
        { href: "/premium", label: t("linkPremium"), icon: IconSparkles },
      ],
    },
  ];

  const roles = [
    profile.is_admin && "Admin",
    profile.is_agent && "Agent",
    profile.is_landlord && "Landlord",
    profile.is_student && "Student",
    profile.is_technician && "Technician",
    profile.is_driver && "Driver",
  ].filter(Boolean) as string[];
  const displayName = profile.full_name || profile.username;
  const verification = VERIFICATION_STYLES[profile.verification_status] ?? VERIFICATION_STYLES.UNVERIFIED;

  const shareUrl = typeof window !== "undefined" && profile ? `${window.location.origin}/user/${profile.id}` : "";

  return (
    <AccountSidebarLayout activeHref="/account">
      <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} className="hidden" />

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/10 mb-6">
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-10 h-64 w-64 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="flex items-center gap-5 min-w-0 flex-1">
            <div className="relative shrink-0">
              <Avatar
                src={profile.profile_image_url}
                name={displayName}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-slate-800 text-amber-400 text-4xl font-black ring-4 ring-white/10 shadow-lg"
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoStatus === "uploading"}
                aria-label={profile.profile_image_url ? "Change photo" : "Upload photo"}
                className="absolute -bottom-2 -right-2 h-9 w-9 rounded-full bg-amber-400 text-slate-900 flex items-center justify-center shadow-lg ring-4 ring-slate-900 hover:bg-amber-300 disabled:opacity-60 transition cursor-pointer"
              >
                <IconUpload size={16} />
              </button>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-300/90">{t("title")}</p>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight truncate">{displayName}</h1>
              <p className="text-sm text-slate-400 truncate">@{profile.username}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${verification.className}`}>
                  {verification.verified ? <IconCheckCircle size={13} /> : <IconAlertCircle size={13} />}
                  {verification.label}
                </span>
                {roles.map((role) => (
                  <span key={role} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200">
                    {role}
                  </span>
                ))}
              </div>
              {photoStatus === "uploading" && <p className="mt-2 text-xs text-slate-300">Uploading...</p>}
              {photoError && <p className="mt-2 text-xs text-red-300">{photoError}</p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/user/${profile.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-white/10 text-white border border-white/15 hover:bg-white/15 transition-colors"
            >
              <span>Public Index</span>
              <IconArrowUpRight size={15} />
            </Link>
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-400 text-slate-900 hover:bg-amber-300 transition-colors shadow-lg shadow-amber-500/20 cursor-pointer"
            >
              <IconQrCode size={16} />
              <span>Share &amp; QR</span>
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-2 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-7 shadow-sm flex flex-col gap-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900">{t("profileSection")}</h2>
              <p className="text-sm text-slate-500 mt-0.5">{t("subtitle")}</p>
            </div>
            {profile.profile_image_url && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition cursor-pointer shrink-0"
              >
                <IconTrash size={14} />
                Remove photo
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="account-username" className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{t("username")}</label>
              <input id="account-username" value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="account-phone" className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{t("phone")}</label>
              <input id="account-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="account-email" className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{t("email")}</label>
              <input id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </div>
          </div>
          <p className="text-xs text-slate-400">Profile photo: JPG, PNG or WebP, up to 10MB.</p>
          {error && <p className="rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
          {saveStatus === "saved" && <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-3.5 py-2.5 text-sm text-emerald-700">{t("saved")}</p>}
          <div className="flex justify-end">
            <Button disabled={saveStatus === "saving"}>{saveStatus === "saving" ? t("saving") : t("saveProfile")}</Button>
          </div>
        </form>

        <div className="flex flex-col gap-6">
          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-4">Account Status</h2>
            <ul className="flex flex-col gap-3">
              <li className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-600">Identity (KYC)</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${verification.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                  {verification.label}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-600">Account</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 capitalize">
                  {profile.account_status.toLowerCase().replace(/_/g, " ")}
                </span>
              </li>
            </ul>
            {!verification.verified && (
              <Link
                href="/kyc"
                className="mt-5 flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                <span>{t("linkKyc")}</span>
                <IconChevronRight size={16} className="text-amber-300" />
              </Link>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-4">My Badges</h2>
            {badges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {badges.map((badge) => (
                  <span key={badge.badge_code} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold">
                    <IconStar size={13} className="text-amber-500" />
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Complete bookings, reviews and verification to earn badges.</p>
            )}
          </div>
        </div>
      </div>

      <ParentAccessManager />

      <div className="mt-8 flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.title}>
            <div className="mb-3">
              <h2 className="text-base font-black tracking-tight text-slate-900">{group.title}</h2>
              <p className="text-sm text-slate-500">{group.description}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {group.links.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex items-center gap-3.5 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-amber-300 transition-colors group-hover:bg-amber-400 group-hover:text-slate-900">
                      <Icon size={20} />
                    </span>
                    <span className="flex-1 text-sm font-bold text-slate-800">{link.label}</span>
                    <IconChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-500" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {profile && (
        <ShareAndQrModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          url={shareUrl}
          title="My Public Profile & Index"
          subtitle="Share your verified public portfolio and QR code with clients, seekers, or partners."
        />
      )}
    </AccountSidebarLayout>
  );
}

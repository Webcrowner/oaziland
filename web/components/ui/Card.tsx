import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The shared card shell for every browse/list page (Hotels, Events,
 * Guest Houses, Student Hostels, Wanted, Agents, Agencies, Trainings,
 * Testimonials, Services, Feed). Extends the exact hover treatment
 * already established across the app (hover:shadow-lg, lift on
 * hover) rather than introducing a competing style — this is a
 * consolidation of an existing pattern into one place, not a new one.
 */
export default function Card({
  children,
  href,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  const classes = `border border-slate-200/80 rounded-2xl overflow-hidden bg-white transition-all duration-200 hover:shadow-xl hover:border-amber-300/60 hover:-translate-y-1 ${className}`;
  if (href) {
    return (
      <Link href={href} className={`block ${classes}`}>
        {children}
      </Link>
    );
  }
  return <div className={classes}>{children}</div>;
}

/** The image/media area at the top of a card — a consistent
 * placeholder treatment until real photos exist for a listing. */
export function CardMedia({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div className={`h-40 bg-slate-100 flex items-center justify-center text-slate-400 text-sm font-medium ${className}`}>
      {label}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

import type { ReactNode, ButtonHTMLAttributes } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The three real button treatments already in use across the app
 * (gold-fill primary action, navy-outline secondary, plain-text
 * ghost) consolidated into one component instead of each page
 * re-writing the same three class strings by hand.
 */
const VARIANTS = {
  primary: "gold-gradient text-[var(--navy)] font-bold hover:shadow-lg hover:shadow-amber-500/25",
  secondary: "border border-slate-300 text-slate-700 font-semibold hover:border-[var(--navy)] hover:bg-slate-50",
  dark: "bg-slate-900 text-white font-bold hover:bg-slate-800",
  success: "bg-emerald-600 text-white font-bold hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-600/25",
  ghost: "text-[var(--navy)] font-medium hover:text-[var(--gold)] underline-offset-2 hover:underline",
} as const;

const SIZES = {
  md: "min-h-11 px-4 py-2 text-sm",
  lg: "min-h-12 px-6 py-3 text-base",
} as const;

type CommonProps = {
  children: ReactNode;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  href,
  className = "",
  ...rest
}: CommonProps & { href?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = `inline-flex items-center justify-center rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}

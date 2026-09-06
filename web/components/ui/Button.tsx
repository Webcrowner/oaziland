import type { ReactNode, ButtonHTMLAttributes } from "react";
import { Link } from "@/i18n/navigation";

/**
 * The three real button treatments already in use across the app
 * (gold-fill primary action, navy-outline secondary, plain-text
 * ghost) consolidated into one component instead of each page
 * re-writing the same three class strings by hand.
 */
const VARIANTS = {
  primary: "bg-[var(--gold)] text-[var(--navy)] font-semibold hover:brightness-105",
  secondary: "border border-[var(--navy)] text-[var(--navy)] font-semibold hover:bg-gray-50",
  ghost: "text-[var(--navy)] font-medium hover:text-[var(--gold)] underline-offset-2 hover:underline",
} as const;

const SIZES = {
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
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
  const classes = `inline-flex items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
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

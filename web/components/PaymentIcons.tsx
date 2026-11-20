import Image from "next/image";

export function MtnIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/icons/payments/mtn.png"
      alt=""
      aria-hidden="true"
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-[4px] object-cover ${className}`.trim()}
    />
  );
}

export function OrangeIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/icons/payments/orange.png"
      alt=""
      aria-hidden="true"
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-[4px] object-cover ${className}`.trim()}
    />
  );
}

/** Compact inline pair of MTN MoMo & Orange Money icons for payment inputs and badges. */
export function MomoBadges({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 ${className}`.trim()} aria-hidden="true">
      <MtnIcon size={size} />
      <OrangeIcon size={size} />
    </span>
  );
}

/* eslint-disable @next/next/no-img-element */
export default function Avatar({
  src,
  name,
  className,
}: {
  src?: string | null;
  name: string;
  className: string;
}) {
  return (
    <div className={`${className} overflow-hidden flex items-center justify-center shrink-0`}>
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        (name.charAt(0) || "?").toUpperCase()
      )}
    </div>
  );
}

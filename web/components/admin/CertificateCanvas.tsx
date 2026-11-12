"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import QRCode from "qrcode";
import type { CertificateElement, CertificateOrientation, CertificateTextElement } from "@/lib/api";

export const DESIGN_WIDTH = 1000;
export const designHeight = (orientation: CertificateOrientation) => (orientation === "PORTRAIT" ? 1414 : 707);

// Match the server's fonts (DejaVu in production, Arial/Georgia locally) as closely as the browser allows.
export const FONT_STACKS = {
  sans: '"DejaVu Sans", Arial, Helvetica, sans-serif',
  serif: '"DejaVu Serif", Georgia, "Times New Roman", serif',
} as const;

export function sampleValues(lang: "en" | "fr", origin: string): Record<string, string> {
  const fr = lang === "fr";
  return {
    learner_name: "Amina Nkeng",
    course_title: fr ? "Gestion immobilière : les bases" : "Property Management Basics",
    trainer_name: "Oaziland Academy",
    issue_date: fr ? "11 novembre 2026" : "November 11, 2026",
    certificate_code: "OZL-SAMPLE1234",
    verify_url: `${origin}/${lang}/certificates/OZL-SAMPLE1234`,
    lessons: fr ? "12 leçons" : "12 lessons",
    course_hours: fr ? "8 heures" : "8 hours",
    final_grade: fr ? "92 %" : "92%",
    completion_date: fr ? "10 novembre 2026" : "November 10, 2026",
    expiry_date: fr ? "11 novembre 2028" : "November 11, 2028",
  };
}

/** Like the server, a text is left out of the certificate when one of its fields has no value (e.g. no expiry date). */
export const hasEmptyPlaceholder = (text: string, values: Record<string, string>) =>
  [...text.matchAll(/\{(\w+)\}/g)].some(([, key]) => key in values && !values[key]);

export const fillPlaceholders = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));

let measureContext: CanvasRenderingContext2D | null = null;
/** Like the server: a single-line text shrinks until it fits its box. */
function fittedSize(element: CertificateTextElement, text: string, scale: number): number {
  let size = element.size * scale;
  if (!element.single_line || typeof document === "undefined") return size;
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return size;
  const maxWidth = element.w * scale;
  for (let i = 0; i < 60 && size > 2; i++) {
    measureContext.font = `${element.bold ? "700 " : ""}${size}px ${FONT_STACKS[element.font]}`;
    if (measureContext.measureText(text).width <= maxWidth) break;
    size *= 0.94;
  }
  return size;
}

type DragMode = "move" | "resize";
type StartDrag = (event: ReactPointerEvent, element: CertificateElement, mode: DragMode) => void;
interface Drag { mode: DragMode; startX: number; startY: number; original: CertificateElement }

interface Props {
  orientation: CertificateOrientation;
  backgroundColor: string;
  backgroundImageUrl: string;
  logoUrl: string;
  /** The template's signature; without one, signature elements show a placeholder in the designer (and nothing on certificates). */
  signatureUrl?: string;
  signaturePlaceholder?: string;
  layout: CertificateElement[];
  lang: "en" | "fr";
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (id: string, patch: Partial<CertificateElement>) => void;
  className?: string;
  resizeLabel?: string;
  /** Real values to show instead of the samples, e.g. this course's title. */
  sampleOverrides?: Record<string, string>;
}

const defaultOrigin = () => (typeof window === "undefined" ? "https://oaziland.com" : window.location.origin);

/** The certificate drawn in the browser. Interactive (drag to move, corner handle to resize) when onChange is given. */
export default function CertificateCanvas({
  orientation, backgroundColor, backgroundImageUrl, logoUrl, signatureUrl = "", signaturePlaceholder, layout, lang, selectedId, onSelect, onChange, className = "", resizeLabel, sampleOverrides,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [width, setWidth] = useState(0);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [origin] = useState(defaultOrigin);
  const interactive = Boolean(onChange);
  const scale = width / DESIGN_WIDTH;
  const values = { ...sampleValues(lang, origin), ...sampleOverrides };

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const qrColors = layout.filter((e) => e.type === "qr").map((e) => (e as { color: string }).color).join(",");
  useEffect(() => {
    let cancelled = false;
    const url = `${origin}/${lang}/certificates/OZL-SAMPLE1234`;
    Promise.all(
      [...new Set(qrColors.split(",").filter(Boolean))].map(async (color) =>
        [color, await QRCode.toDataURL(url, { margin: 1, width: 300, color: { dark: color, light: "#ffffff" } })] as const,
      ),
    ).then((entries) => !cancelled && setQr(Object.fromEntries(entries)));
    return () => { cancelled = true; };
  }, [qrColors, lang, origin]);

  const startDrag: StartDrag = (event, element, mode) => {
    if (!interactive) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect?.(element.id);
    drag.current = { mode, startX: event.clientX, startY: event.clientY, original: element };
    frameRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current || !onChange || !scale) return;
    const dx = (event.clientX - current.startX) / scale;
    const dy = (event.clientY - current.startY) / scale;
    const o = current.original;
    const round = (n: number) => Math.round(n * 2) / 2;
    if (current.mode === "move") {
      let x = round(o.x + dx);
      // Snap to the horizontal centre of the page.
      if (Math.abs(x + o.w / 2 - DESIGN_WIDTH / 2) < 4) x = round(DESIGN_WIDTH / 2 - o.w / 2);
      onChange(o.id, { x, y: round(o.y + dy) });
    } else {
      const w = Math.max(5, round(o.w + dx));
      onChange(o.id, o.type === "rect" ? { w, h: Math.max(5, round(o.h + dy)) } : { w });
    }
  };

  const endDrag = () => { drag.current = null; };
  const height = designHeight(orientation) * scale;

  return (
    <div
      ref={frameRef}
      className={`relative w-full select-none overflow-hidden ${className}`}
      style={{ height: height || undefined, aspectRatio: height ? undefined : `${DESIGN_WIDTH} / ${designHeight(orientation)}`, background: backgroundColor }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={() => interactive && onSelect?.(null)}
    >
      {backgroundImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backgroundImageUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      )}
      {scale > 0 &&
        layout.map((element) => (
          <ElementView
            key={element.id}
            element={element}
            scale={scale}
            lang={lang}
            values={values}
            qrSrc={element.type === "qr" ? qr[element.color] : undefined}
            logoUrl={logoUrl}
            signatureUrl={signatureUrl}
            signaturePlaceholder={interactive ? signaturePlaceholder : undefined}
            interactive={interactive}
            selected={interactive && element.id === selectedId}
            resizeLabel={resizeLabel}
            onStartDrag={startDrag}
          />
        ))}
    </div>
  );
}

function ElementView({ element, scale, lang, values, qrSrc, logoUrl, signatureUrl, signaturePlaceholder, interactive, selected, resizeLabel, onStartDrag }: {
  element: CertificateElement;
  scale: number;
  lang: "en" | "fr";
  values: Record<string, string>;
  qrSrc?: string;
  logoUrl: string;
  signatureUrl: string;
  signaturePlaceholder?: string;
  interactive: boolean;
  selected: boolean;
  resizeLabel?: string;
  onStartDrag: StartDrag;
}) {
  const px = (n: number) => `${n * scale}px`;
  const base: CSSProperties = {
    position: "absolute", left: px(element.x), top: px(element.y), width: px(element.w),
    cursor: interactive ? "move" : undefined, touchAction: "none",
    outline: selected ? "1.5px dashed #2563eb" : undefined, outlineOffset: 2,
  };
  let body: ReactNode = null;
  let style = base;
  if (element.type === "text") {
    const source = lang === "fr" && element.text_fr ? element.text_fr : element.text;
    const filled = hasEmptyPlaceholder(source, values) ? "" : fillPlaceholders(source, values).trim();
    const shown = element.single_line ? (filled || source).split(/\s+/).join(" ") : filled || source;
    style = {
      ...base, fontSize: `${fittedSize(element, shown, scale)}px`, lineHeight: 1.2, color: element.color,
      fontFamily: FONT_STACKS[element.font], fontWeight: element.bold ? 700 : 400, textAlign: element.align,
      whiteSpace: element.single_line ? "nowrap" : "pre-wrap", overflowWrap: "break-word",
      minHeight: px(element.size * 1.2), opacity: filled ? 1 : 0.35, // a field with nothing to show (e.g. no lessons) is hidden on certificates
    };
    body = shown;
  } else if (element.type === "logo") {
    // eslint-disable-next-line @next/next/no-img-element
    body = <img src={logoUrl || "/logo.png"} alt="" draggable={false} style={{ width: "100%", height: "auto", display: "block" }} />;
  } else if (element.type === "signature") {
    if (signatureUrl) {
      // eslint-disable-next-line @next/next/no-img-element
      body = <img src={signatureUrl} alt="" draggable={false} style={{ width: "100%", height: "auto", display: "block" }} />;
    } else if (signaturePlaceholder) {
      style = { ...base, height: px(element.w * 0.35), border: "1.5px dashed #94A3B8", borderRadius: 4 };
      body = (
        <span style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", fontSize: px(Math.max(element.w * 0.08, 9)), color: "#64748B", fontStyle: "italic" }}>
          ✍ {signaturePlaceholder}
        </span>
      );
    }
  } else if (element.type === "qr") {
    style = { ...base, height: px(element.w), background: "#fff" };
    body = qrSrc ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={qrSrc} alt="" draggable={false} style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }} />
    ) : null;
  } else if (element.type === "line") {
    const thickness = Math.max(element.thickness * scale, 1);
    style = { ...base, top: `${element.y * scale - thickness / 2}px`, height: `${thickness}px`, background: element.color };
  } else if (element.type === "rect") {
    style = {
      ...base, height: px(element.h), boxSizing: "border-box",
      border: `${Math.max(element.thickness * scale, 1)}px solid ${element.color}`,
      // A frame is only grabbed by its edges, so the elements inside it stay clickable.
      pointerEvents: interactive ? "none" : undefined,
    };
  }
  return (
    <div style={style} onPointerDown={(e) => onStartDrag(e, element, "move")}>
      {element.type === "rect" && interactive &&
        (["top", "bottom", "left", "right"] as const).map((side) => (
          <div
            key={side}
            onPointerDown={(e) => onStartDrag(e, element, "move")}
            style={{
              position: "absolute", pointerEvents: "auto", cursor: "move",
              ...(side === "top" || side === "bottom" ? { left: -4, right: -4, height: 10, [side]: -5 } : { top: -4, bottom: -4, width: 10, [side]: -5 }),
            }}
          />
        ))}
      {body}
      {selected && (
        <div
          onPointerDown={(e) => onStartDrag(e, element, "resize")}
          title={resizeLabel}
          style={{
            position: "absolute", right: -7, bottom: -7, width: 12, height: 12, background: "#2563eb",
            border: "2px solid #fff", borderRadius: 3, cursor: "nwse-resize", pointerEvents: "auto",
          }}
        />
      )}
    </div>
  );
}

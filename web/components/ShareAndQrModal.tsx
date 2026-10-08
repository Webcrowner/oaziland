"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  IconShare,
  IconQrCode,
  IconX,
  IconDownload,
  IconCopy,
  IconCheckCircle,
} from "@/components/Icons";

interface ShareAndQrModalProps {
  url: string;
  title: string;
  subtitle?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ShareAndQrModal({
  url,
  title,
  subtitle,
  isOpen,
  onClose,
}: ShareAndQrModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrGenerated, setQrGenerated] = useState(false);

  useEffect(() => {
    if (!isOpen || !url) return;
    setCopied(false);
    setQrGenerated(false);

    // Wait for modal DOM to be ready
    const timer = setTimeout(() => {
      if (canvasRef.current) {
        QRCode.toCanvas(
          canvasRef.current,
          url,
          {
            width: 256,
            margin: 2,
            color: {
              dark: "#0F172A", // Slate 900
              light: "#FFFFFF",
            },
          },
          (err) => {
            if (!err) {
              setQrGenerated(true);
            }
          }
        );
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, url]);

  if (!isOpen) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback prompt
      window.prompt("Copy link:", url);
    }
  }

  function handleDownloadQr() {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = `oaziland-qr-${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}.png`;
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  }

  async function handleNativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title,
          text: subtitle || title,
          url,
        });
      } catch {
        // User canceled or failed, harmless
      }
    } else {
      handleCopy();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl border border-slate-100 text-center relative animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <IconX size={20} />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200/50">
          <IconQrCode size={26} />
        </div>

        <h3 className="text-xl font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}

        {/* QR Code Canvas */}
        <div className="my-6 p-4 bg-slate-50 border border-slate-200/70 rounded-2xl flex flex-col items-center justify-center">
          <canvas ref={canvasRef} className="rounded-xl shadow-xs max-w-full" />
          <p className="text-xs text-slate-400 mt-2 font-medium">
            Scan with any camera or QR scanner
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5 mb-4">
          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={!qrGenerated}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-sm disabled:opacity-50"
          >
            <IconDownload size={15} />
            <span>Download QR</span>
          </button>

          <button
            type="button"
            onClick={handleNativeShare}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-400 text-slate-950 hover:bg-amber-300 transition-all shadow-sm"
          >
            <IconShare size={15} />
            <span>Share Page</span>
          </button>
        </div>

        {/* Link copy field */}
        <div className="flex items-center gap-2 p-2 bg-slate-100/80 rounded-xl border border-slate-200/60 text-left">
          <input
            type="text"
            readOnly
            value={url}
            className="bg-transparent text-xs text-slate-600 flex-1 outline-hidden select-all px-2 truncate font-mono"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 p-1.5 px-3 rounded-lg bg-white text-slate-800 text-xs font-semibold shadow-xs hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            {copied ? (
              <>
                <IconCheckCircle size={14} className="text-emerald-600" />
                <span className="text-emerald-700">Copied</span>
              </>
            ) : (
              <>
                <IconCopy size={14} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

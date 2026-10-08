"use client";

import { useState, useEffect } from "react";
import ShareAndQrModal from "@/components/ShareAndQrModal";
import { IconShare, IconQrCode } from "@/components/Icons";

interface AgentShareButtonProps {
  userId?: string;
  customUrl?: string;
  name: string;
}

export default function AgentShareButton({ userId, customUrl, name }: AgentShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (customUrl) {
        setUrl(customUrl.startsWith("http") ? customUrl : `${window.location.origin}${customUrl}`);
      } else if (userId) {
        setUrl(`${window.location.origin}/user/${userId}`);
      }
    }
  }, [userId, customUrl]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-amber-300 hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
      >
        <IconQrCode size={15} />
        <IconShare size={14} />
        <span>Share & QR</span>
      </button>

      <ShareAndQrModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        url={url}
        title={`${name}'s Portfolio`}
        subtitle="Share this verified portfolio page or scan the QR code to view all offerings."
      />
    </>
  );
}

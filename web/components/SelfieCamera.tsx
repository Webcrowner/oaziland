"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { uploadMediaFile, type MediaUploadResult } from "@/lib/api";

/**
 * A real, LIVE camera selfie capture — not a gallery/file picker.
 * WHY live capture specifically: an uploaded gallery photo could be an
 * old photo of someone else entirely; requiring a live camera frame is
 * the same basic anti-spoofing measure every real identity-verification
 * provider (Smile Identity, Onfido, Persona) uses for the selfie step.
 */
export default function SelfieCamera({
  folder,
  onUploaded,
  capturedUrl,
}: {
  folder: string;
  onUploaded: (result: MediaUploadResult) => void;
  capturedUrl?: string;
}) {
  const t = useTranslations("SelfieCamera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  useEffect(() => stopCamera, []);

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setError(t("cameraAccessDenied"));
    }
  }

  async function handleCapture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const token = localStorage.getItem("access_token");
      if (!token) return;

      setUploading(true);
      try {
        const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
        const result = await uploadMediaFile(file, folder, token);
        onUploaded(result);
        stopCamera();
      } catch {
        setError(t("uploadFailed"));
      } finally {
        setUploading(false);
      }
    }, "image/jpeg", 0.9);
  }

  if (capturedUrl) {
    return (
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={capturedUrl} alt="" className="w-28 h-28 rounded-full object-cover ring-4 ring-emerald-400 shadow-md" />
        <button
          type="button"
          onClick={() => { onUploaded({ url: "", media_type: "PHOTO" }); startCamera(); }}
          className="text-xs font-bold px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        >
          {t("retakeButton")}
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Always mounted (even before the camera starts) so startCamera()
          can actually attach the stream to a real DOM node — it was
          previously only rendered once cameraOn became true, which is
          AFTER the stream was already assigned, so it silently never
          received a frame and showed as a plain dark box. */}
      <video
        ref={videoRef}
        muted
        playsInline
        className={`w-64 h-64 mx-auto rounded-full object-cover bg-slate-900 ring-4 ring-amber-400 shadow-lg -scale-x-100 ${cameraOn ? "" : "hidden"}`}
      />
      {cameraOn ? (
        <div className="flex justify-center gap-2 mt-4">
          <button
            type="button"
            onClick={handleCapture}
            disabled={uploading}
            className="bg-slate-900 text-white text-sm font-bold px-5 py-2.5 rounded-xl disabled:opacity-50 hover:bg-slate-800"
          >
            {uploading ? t("uploading") : t("captureButton")}
          </button>
          <button type="button" onClick={stopCamera} className="bg-slate-100 text-slate-700 text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-slate-200">
            {t("cancelButton")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startCamera}
          className="w-full flex flex-col items-center justify-center gap-2 h-40 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-700 font-bold text-sm hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
        >
          <span className="text-2xl" aria-hidden="true">📷</span>
          {t("startCameraButton")}
        </button>
      )}
      {error && <p className="text-red-600 text-xs mt-2 text-center">{error}</p>}
    </div>
  );
}

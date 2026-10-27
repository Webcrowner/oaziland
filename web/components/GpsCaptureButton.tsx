"use client";

import { useState } from "react";
import { IconMapPin, IconCheckCircle, IconCompass } from "@/components/Icons";

interface GpsCaptureButtonProps {
  onCapture: (coords: { latitude: number; longitude: number }) => void;
  currentCoords?: { latitude: number | null | undefined; longitude: number | null | undefined };
  className?: string;
  label?: string;
  onClear?: () => void;
  clearLabel?: string;
  hint?: string;
  buttonClassName?: string;
}

export default function GpsCaptureButton({
  onCapture,
  currentCoords,
  className = "",
  label = "Capture Real GPS Location",
  onClear,
  clearLabel = "Remove",
  hint = "Captures your exact device GPS coordinates so seekers and visitors can navigate directly to the property doorstep.",
  buttonClassName = "bg-amber-400 text-slate-950 hover:bg-amber-300",
}: GpsCaptureButtonProps) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleCaptureGps() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser or device.");
      return;
    }

    setCapturing(true);
    setError(null);
    setSuccess(false);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCapturing(false);
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        onCapture({ latitude: lat, longitude: lng });
        setSuccess(true);
        setTimeout(() => setSuccess(false), 4000);
      },
      (err) => {
        setCapturing(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission denied. Please allow GPS access in your browser settings.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("GPS signal unavailable. Ensure your device location is switched on.");
        } else {
          setError("Timeout getting GPS location. Please try again.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }

  const hasCoords =
    currentCoords?.latitude !== undefined &&
    currentCoords?.latitude !== null &&
    currentCoords?.longitude !== undefined &&
    currentCoords?.longitude !== null;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleCaptureGps}
          disabled={capturing}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all shadow-xs disabled:opacity-60 cursor-pointer ${buttonClassName}`}
        >
          {capturing ? (
            <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
          ) : (
            <IconMapPin size={15} />
          )}
          <span>{capturing ? "Acquiring GPS Signal..." : label}</span>
        </button>

        {hasCoords && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-mono border border-slate-200">
            <IconCompass size={13} className="text-amber-600" />
            <span>
              {Number(currentCoords.latitude).toFixed(5)}, {Number(currentCoords.longitude).toFixed(5)}
            </span>
            <IconCheckCircle size={13} className="text-emerald-600 ml-0.5" />
          </div>
        )}

        {hasCoords && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 underline cursor-pointer"
          >
            {clearLabel}
          </button>
        )}

        {success && (
          <span className="text-xs font-bold text-emerald-600 animate-in fade-in">
            ✓ GPS captured accurately!
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5">
          {error}
        </p>
      )}

      <p className="text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}

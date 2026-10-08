"use client";
import { useState, useRef, useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { checkMediaFile, uploadMediaFile, type MediaUploadResult } from "@/lib/api";

/**
 * Photo/video picker and uploader. Several files can be chosen at
 * once; each is uploaded in turn and reported through onUploaded, so
 * callers that already append to a list need no changes. accept
 * includes video so mobile browsers also offer "record a video".
 */
export default function MediaUploader({
  folder,
  onUploaded,
  label,
  multiple = true,
  accept = "image/*,video/*",
  triggerClassName,
}: {
  folder: string;
  onUploaded: (result: MediaUploadResult) => void;
  label: ReactNode;
  multiple?: boolean;
  accept?: string;
  triggerClassName?: string;
}) {
  const t = useTranslations("MediaUploader");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [percent, setPercent] = useState(0);
  const [currentName, setCurrentName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  function cancelUpload() {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;

    const token = localStorage.getItem("access_token");
    if (!token) {
      window.location.href = "/login";
      return;
    }

    // Reject unsupported / oversized files up front instead of after a long upload.
    const problems: string[] = [];
    const files = picked.filter((file) => {
      const problem = checkMediaFile(file);
      if (!problem) return true;
      problems.push(
        problem.code === "unsupported"
          ? t("unsupportedType", { name: file.name })
          : t("tooLarge", { name: file.name, size: problem.sizeMb, limit: problem.limitMb })
      );
      return false;
    });
    if (files.length === 0) {
      setErrors(problems);
      setStatus("error");
      return;
    }

    cancelledRef.current = false;
    setStatus("uploading");
    setErrors([]);
    setProgress({ done: 0, total: files.length });
    for (const file of files) {
      if (cancelledRef.current) break;
      setCurrentName(file.name);
      setPercent(0);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        onUploaded(await uploadMediaFile(file, folder, token, { onProgress: setPercent, signal: controller.signal }));
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          const detail = err instanceof Error && err.message !== "Upload failed" ? err.message : t("uploadFailed");
          problems.push(`${file.name}: ${detail}`);
        }
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    abortRef.current = null;
    if (cancelledRef.current) problems.push(t("cancelled"));
    setErrors(problems);
    setStatus(problems.length > 0 ? "error" : "idle");
  }

  return (
    <div>
      <input
        ref={inputRef} type="file" accept={accept} multiple={multiple} onChange={handleFileChange}
        id={inputId} className="hidden"
      />
      {status === "uploading" ? (
        <div className="w-full min-w-[15rem] rounded-xl border border-slate-200 bg-white p-3 text-left">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
            <span className="truncate">{currentName}</span>
            <span className="shrink-0">{percent < 100 ? `${percent}%` : t("finishing")}</span>
          </div>
          <div
            className="h-2 mt-2 rounded-full bg-slate-100 overflow-hidden"
            role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          >
            <div className="h-full rounded-full bg-[var(--gold)] transition-[width] duration-200" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
            <span>{progress.total > 1 ? t("fileOf", { current: Math.min(progress.done + 1, progress.total), total: progress.total }) : ""}</span>
            <button type="button" onClick={cancelUpload} className="font-bold text-rose-600 hover:text-rose-700">
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={triggerClassName ?? "inline-flex items-center gap-2 border border-[var(--navy)] text-[var(--navy)] font-semibold px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors text-sm"}
        >
          {label}
        </label>
      )}
      {status === "error" && (
        <ul className="text-red-600 text-xs mt-1 space-y-0.5" role="alert">
          {errors.map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

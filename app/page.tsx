"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearHistory,
  deleteConversion,
  listConversions,
  saveConversion,
  type HistoryEntry,
} from "@/lib/history";

type DetectedImage = {
  id: string;
  filename: string;
  dataUri: string;
};

type ConvertResult = {
  mjml: string;
  html: string;
  previewHtml: string;
  images: DetectedImage[];
  warnings: string[];
};

type Tab = "preview" | "mjml" | "html";

const PROGRESS_STEPS = [
  "Uploading screenshot…",
  "Reading layout and colors…",
  "Writing MJML…",
  "Extracting real images…",
  "Compiling Outlook-safe HTML…",
];

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    listConversions()
      .then(setHistory)
      .catch(() => {
        // IndexedDB unavailable (private browsing, etc.) — history is best-effort.
      });
  }, []);

  const handleFile = useCallback((f: File | null) => {
    setResult(null);
    setError(null);
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }, []);

  // Let people paste a screenshot straight from the clipboard instead of only
  // dragging or browsing for a file — only while the upload screen is showing.
  useEffect(() => {
    if (result || loading || historyOpen) return;
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/")
      );
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob) return;
      e.preventDefault();
      handleFile(new File([blob], blob.name || "pasted-screenshot.png", { type: blob.type }));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [result, loading, historyOpen, handleFile]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) handleFile(dropped);
    },
    [handleFile]
  );

  const onConvert = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setProgressIndex(0);
    progressTimerRef.current = setInterval(() => {
      setProgressIndex((i) => (i + 1) % PROGRESS_STEPS.length);
    }, 1600);

    try {
      const [screenshotDataUri, res] = await Promise.all([
        fileToDataUri(file),
        (async () => {
          const formData = new FormData();
          formData.append("image", file);
          return fetch("/api/convert", { method: "POST", body: formData });
        })(),
      ]);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      setResult(data);
      setTab("preview");

      try {
        const entry = await saveConversion({
          sourceFilename: file.name,
          screenshotDataUri,
          result: data,
        });
        setHistory((prev) => [entry, ...prev].slice(0, 20));
      } catch {
        // History is a convenience feature, not core functionality — never
        // block or error out the conversion because saving it failed.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    }
  }, [file]);

  const copyCode = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const downloadCode = useCallback((text: string, filename: string) => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadImage = useCallback((dataUri: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUri;
    a.download = filename;
    a.click();
  }, []);

  const reset = useCallback(() => {
    handleFile(null);
    setResult(null);
    setError(null);
  }, [handleFile]);

  const openHistoryEntry = useCallback((entry: HistoryEntry) => {
    setResult(entry.result);
    setTab("preview");
    setError(null);
    setHistoryOpen(false);
  }, []);

  const onDeleteHistoryEntry = useCallback(async (id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id));
    try {
      await deleteConversion(id);
    } catch {
      // Best-effort — the in-memory list is already updated for the UI.
    }
  }, []);

  const onClearHistory = useCallback(async () => {
    setHistory([]);
    try {
      await clearHistory();
    } catch {
      // Best-effort.
    }
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-10 sm:py-16 bg-gradient-to-b from-indigo-50/50 to-white text-neutral-900">
      <div className="w-full max-w-4xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Email Screenshot <span className="text-indigo-600">→</span> MJML
            </h1>
            <p className="mt-2 text-sm text-neutral-500 max-w-md">
              Upload a screenshot of an email design and get back editable, Outlook-safe MJML
              and compiled HTML.
            </p>
          </div>
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className="shrink-0 self-start rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
          >
            {historyOpen ? "← Back" : `History${history.length ? ` (${history.length})` : ""}`}
          </button>
        </header>

        {historyOpen && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-neutral-800">Past conversions</h2>
              {history.length > 0 && (
                <button
                  onClick={onClearHistory}
                  className="text-xs font-medium text-red-500 hover:text-red-700"
                >
                  Clear all
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 px-6 py-14 text-center text-sm text-neutral-500">
                No conversions yet — they&apos;ll show up here after your first one, saved right
                in this browser.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="group relative rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md hover:border-neutral-300 transition-all"
                  >
                    <button
                      onClick={() => openHistoryEntry(entry)}
                      className="block w-full text-left cursor-pointer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={entry.screenshotDataUri}
                        alt={entry.sourceFilename}
                        className="h-28 w-full object-cover bg-neutral-100"
                      />
                      <div className="p-2.5">
                        <p className="text-xs font-medium truncate text-neutral-800">
                          {entry.sourceFilename}
                        </p>
                        <p className="text-[11px] text-neutral-400 mt-0.5">
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => onDeleteHistoryEntry(entry.id)}
                      aria-label={`Delete ${entry.sourceFilename}`}
                      className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-white transition-opacity shadow-sm"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!historyOpen && !result && (
          <div className="space-y-6">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => !loading && inputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed transition-colors px-6 py-14 text-center ${
                loading
                  ? "border-neutral-200 bg-neutral-50 cursor-default"
                  : "border-neutral-300 bg-neutral-50 hover:bg-neutral-100 hover:border-indigo-300 cursor-pointer"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              {previewUrl ? (
                <div className="flex flex-col items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Selected email screenshot"
                    className="max-h-72 rounded-lg border border-neutral-200 shadow-sm"
                  />
                  {!loading && (
                    <p className="text-sm text-neutral-500">{file?.name} — click to replace</p>
                  )}
                </div>
              ) : (
                <div className="text-neutral-500">
                  <p className="font-medium text-neutral-700">
                    Drop an email screenshot here, click to browse, or paste from your clipboard
                  </p>
                  <p className="text-sm mt-1">PNG, JPEG, or WebP — up to 8MB</p>
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex flex-col items-center gap-3">
              <button
                onClick={onConvert}
                disabled={!file || loading}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
              >
                {loading && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {loading ? "Converting…" : "Convert to MJML"}
              </button>

              {loading && (
                <div className="flex flex-col items-center gap-2">
                  <div className="relative h-1.5 w-56 overflow-hidden rounded-full bg-neutral-200">
                    <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-indigo-600 [animation:indeterminate-progress_1.4s_ease-in-out_infinite]" />
                  </div>
                  <p className="text-xs text-neutral-500">{PROGRESS_STEPS[progressIndex]}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!historyOpen && result && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
                {(["preview", "mjml", "html"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                      tab === t ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500"
                    }`}
                  >
                    {t === "preview" ? "Live preview" : t.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={reset}
                className="text-sm font-medium text-neutral-500 hover:text-neutral-800"
              >
                Start over
              </button>
            </div>

            {result.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <p className="font-semibold mb-1">Warnings:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.images.length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-xs font-semibold text-blue-900 mb-1">
                  {result.images.length} real image
                  {result.images.length > 1 ? "s" : ""} cropped from your screenshot
                </p>
                <p className="text-xs text-blue-800 mb-3">
                  These are actual pixels from your upload, not AI-generated. The code below
                  references them as <code>{"images/<name>.png"}</code> — download each one, host
                  it wherever you host images, and the paths will line up (or edit the{" "}
                  <code>src</code> to match your host).
                </p>
                <div className="flex flex-wrap gap-3">
                  {result.images.map((img) => (
                    <div
                      key={img.id}
                      className="flex flex-col items-center gap-1 rounded-lg border border-blue-200 bg-white p-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.dataUri} alt={img.id} className="h-16 w-auto rounded" />
                      <button
                        onClick={() => downloadImage(img.dataUri, `${img.id}.png`)}
                        className="text-[11px] font-medium text-blue-700 hover:text-blue-900"
                      >
                        Download {img.id}.png
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "preview" && (
              <div className="rounded-xl border border-neutral-200 overflow-hidden bg-neutral-50">
                <iframe
                  title="Email preview"
                  srcDoc={result.previewHtml}
                  className="w-full h-[600px] bg-white"
                  sandbox=""
                />
              </div>
            )}

            {(tab === "mjml" || tab === "html") && (
              <div className="relative rounded-xl border border-neutral-200 bg-neutral-950 overflow-hidden">
                <div className="flex justify-end gap-2 border-b border-neutral-800 px-3 py-2">
                  <button
                    onClick={() => copyCode(tab === "mjml" ? result.mjml : result.html)}
                    className="text-xs font-medium text-neutral-300 hover:text-white"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() =>
                      downloadCode(
                        tab === "mjml" ? result.mjml : result.html,
                        tab === "mjml" ? "email.mjml" : "email.html"
                      )
                    }
                    className="text-xs font-medium text-neutral-300 hover:text-white"
                  >
                    Download
                  </button>
                </div>
                <pre className="max-h-[600px] overflow-auto p-4 text-xs leading-relaxed text-neutral-100">
                  <code>{tab === "mjml" ? result.mjml : result.html}</code>
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useRef, useState } from "react";

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

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File | null) => {
    setResult(null);
    setError(null);
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }, []);

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
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/convert", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      setResult(data);
      setTab("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [file]);

  const copyCode = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    []
  );

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

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-10 sm:py-16 bg-white text-neutral-900">
      <div className="w-full max-w-4xl">
        <header className="mb-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Email Screenshot → MJML
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Upload a screenshot of an email design and get back editable, Outlook-safe MJML and
            compiled HTML.
          </p>
        </header>

        {!result && (
          <div className="space-y-6">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 hover:bg-neutral-100 transition-colors px-6 py-14 text-center"
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
                  <p className="text-sm text-neutral-500">{file?.name} — click to replace</p>
                </div>
              ) : (
                <div className="text-neutral-500">
                  <p className="font-medium text-neutral-700">
                    Drop an email screenshot here, or click to browse
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

            <div className="flex justify-center">
              <button
                onClick={onConvert}
                disabled={!file || loading}
                className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-700 transition-colors"
              >
                {loading ? "Converting…" : "Convert to MJML"}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
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

// Client-side conversion history, stored in the browser's IndexedDB (not a
// server database — there is still no backend persistence by design). This
// only ever runs in the browser; every exported function is a no-op-safe
// promise that rejects gracefully if IndexedDB isn't available (e.g. some
// privacy modes), so callers should treat history as best-effort.
"use client";

const DB_NAME = "email2code-history";
const DB_VERSION = 1;
const STORE_NAME = "conversions";
const MAX_HISTORY = 20; // keep this small — each entry embeds full images as data URIs.

export interface HistoryImage {
  id: string;
  filename: string;
  dataUri: string;
}

export interface HistoryResult {
  mjml: string;
  html: string;
  previewHtml: string;
  images: HistoryImage[];
  warnings: string[];
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  sourceFilename: string;
  screenshotDataUri: string;
  result: HistoryResult;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open history database."));
  });
}

export async function saveConversion(
  entry: Omit<HistoryEntry, "id" | "createdAt">
): Promise<HistoryEntry> {
  const db = await openDb();
  const full: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save conversion."));
  });

  await pruneOldest(db);
  db.close();
  return full;
}

async function pruneOldest(db: IDBDatabase): Promise<void> {
  const all = await listFromDb(db);
  if (all.length <= MAX_HISTORY) return;
  const toDelete = all
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, all.length - MAX_HISTORY);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const entry of toDelete) store.delete(entry.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to prune history."));
  });
}

function listFromDb(db: IDBDatabase): Promise<HistoryEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as HistoryEntry[]);
    req.onerror = () => reject(req.error ?? new Error("Failed to read history."));
  });
}

export async function listConversions(): Promise<HistoryEntry[]> {
  const db = await openDb();
  const all = await listFromDb(db);
  db.close();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteConversion(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete conversion."));
  });
  db.close();
}

export async function clearHistory(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear history."));
  });
  db.close();
}

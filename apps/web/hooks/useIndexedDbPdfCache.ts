"use client";

import { useCallback } from "react";

const DB_NAME = "scholarpulse-pdf-cache";
const SNIPPET_STORE = "snippets";
const PDF_STORE = "pdf-docs";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SNIPPETS = 600;
const MAX_PDF_BYTES = 140 * 1024 * 1024;

type CacheEntry = {
  key: string;
  value: string;
  savedAt: number;
  lastAccessedAt: number;
};

type PdfCacheEntry = {
  docId: string;
  bytes: ArrayBuffer;
  byteLength: number;
  savedAt: number;
  lastAccessedAt: number;
};

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SNIPPET_STORE)) {
        request.result.createObjectStore(SNIPPET_STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(PDF_STORE)) {
        request.result.createObjectStore(PDF_STORE, { keyPath: "docId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function pruneSnippetEntries(db: IDBDatabase) {
  const tx = db.transaction(SNIPPET_STORE, "readwrite");
  const store = tx.objectStore(SNIPPET_STORE);
  const request = store.getAll();
  request.onsuccess = () => {
    const rows = (request.result ?? []) as CacheEntry[];
    const now = Date.now();
    const alive = rows.filter((row) => now - row.savedAt <= CACHE_TTL_MS);
    for (const row of rows) {
      if (now - row.savedAt > CACHE_TTL_MS) {
        store.delete(row.key);
      }
    }
    if (alive.length <= MAX_SNIPPETS) {
      return;
    }
    alive
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
      .slice(0, alive.length - MAX_SNIPPETS)
      .forEach((entry) => {
        store.delete(entry.key);
      });
  };
}

function prunePdfEntries(db: IDBDatabase) {
  const tx = db.transaction(PDF_STORE, "readwrite");
  const store = tx.objectStore(PDF_STORE);
  const request = store.getAll();
  request.onsuccess = () => {
    const rows = (request.result ?? []) as PdfCacheEntry[];
    const now = Date.now();
    const alive = rows.filter((row) => now - row.savedAt <= CACHE_TTL_MS);
    for (const row of rows) {
      if (now - row.savedAt > CACHE_TTL_MS) {
        store.delete(row.docId);
      }
    }
    let total = alive.reduce((sum, row) => sum + row.byteLength, 0);
    if (total <= MAX_PDF_BYTES) {
      return;
    }
    const sorted = [...alive].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const row of sorted) {
      if (total <= MAX_PDF_BYTES) {
        break;
      }
      total -= row.byteLength;
      store.delete(row.docId);
    }
  };
}

export function useIndexedDbPdfCache() {
  const getCachedSnippet = useCallback(async (key: string): Promise<string | null> => {
    const db = await openCacheDb();
    if (!db) {
      return null;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(SNIPPET_STORE, "readonly");
      const request = tx.objectStore(SNIPPET_STORE).get(key);
      request.onsuccess = () => {
        const value = request.result as CacheEntry | undefined;
        if (!value) {
          resolve(null);
          return;
        }
        if (Date.now() - value.savedAt > CACHE_TTL_MS) {
          const cleanupTx = db.transaction(SNIPPET_STORE, "readwrite");
          cleanupTx.objectStore(SNIPPET_STORE).delete(key);
          resolve(null);
          return;
        }
        const touchTx = db.transaction(SNIPPET_STORE, "readwrite");
        touchTx.objectStore(SNIPPET_STORE).put({
          ...value,
          lastAccessedAt: Date.now()
        } satisfies CacheEntry);
        resolve(value.value);
      };
      request.onerror = () => resolve(null);
    });
  }, []);

  const setCachedSnippet = useCallback(async (key: string, value: string) => {
    const db = await openCacheDb();
    if (!db) {
      return;
    }
    await new Promise<void>((resolve) => {
      const now = Date.now();
      const tx = db.transaction(SNIPPET_STORE, "readwrite");
      tx.objectStore(SNIPPET_STORE).put({
        key,
        value,
        savedAt: now,
        lastAccessedAt: now
      } as CacheEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    pruneSnippetEntries(db);
  }, []);

  const getCachedPdf = useCallback(async (docId: string): Promise<ArrayBuffer | null> => {
    const db = await openCacheDb();
    if (!db) {
      return null;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(PDF_STORE, "readonly");
      const request = tx.objectStore(PDF_STORE).get(docId);
      request.onsuccess = () => {
        const row = request.result as PdfCacheEntry | undefined;
        if (!row) {
          resolve(null);
          return;
        }
        if (Date.now() - row.savedAt > CACHE_TTL_MS) {
          const cleanupTx = db.transaction(PDF_STORE, "readwrite");
          cleanupTx.objectStore(PDF_STORE).delete(docId);
          resolve(null);
          return;
        }
        const touchTx = db.transaction(PDF_STORE, "readwrite");
        touchTx.objectStore(PDF_STORE).put({
          ...row,
          lastAccessedAt: Date.now()
        } satisfies PdfCacheEntry);
        resolve(row.bytes.slice(0));
      };
      request.onerror = () => resolve(null);
    });
  }, []);

  const setCachedPdf = useCallback(async (docId: string, bytes: ArrayBuffer) => {
    const db = await openCacheDb();
    if (!db) {
      return;
    }
    await new Promise<void>((resolve) => {
      const now = Date.now();
      const tx = db.transaction(PDF_STORE, "readwrite");
      tx.objectStore(PDF_STORE).put({
        docId,
        bytes,
        byteLength: bytes.byteLength,
        savedAt: now,
        lastAccessedAt: now
      } satisfies PdfCacheEntry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    prunePdfEntries(db);
  }, []);

  return { getCachedSnippet, setCachedSnippet, getCachedPdf, setCachedPdf };
}

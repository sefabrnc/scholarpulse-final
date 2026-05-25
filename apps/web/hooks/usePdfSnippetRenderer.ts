"use client";

import { useCallback, useMemo, useRef } from "react";
import type { NormRect } from "../types/citation";
import { buildSnippetCacheKey, isNormRectVisible } from "../utils/pdf/normRect";
import { useIndexedDbPdfCache } from "./useIndexedDbPdfCache";

const DEFAULT_SCALE = 1.35;
const CACHE_VERSION = "snippet-v2";
const MAX_CONCURRENT_RENDERS = 4;

type RenderSnippetInput = {
  docId: string;
  page: number;
  normRect: NormRect;
  width: number;
  height: number;
  scale?: number;
};

class RenderSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

function renderFallbackDataUrl(width: number, height: number): string {
  if (typeof document === "undefined") {
    return "";
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "";
  }
  ctx.fillStyle = "#eef3ff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(37, 99, 235, 0.65)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
  ctx.fillRect(8, Math.max(8, Math.floor(canvas.height * 0.35)), canvas.width - 16, Math.max(8, Math.floor(canvas.height * 0.18)));
  return canvas.toDataURL("image/png");
}

export function usePdfSnippetRenderer() {
  const { getCachedSnippet, setCachedSnippet, getCachedPdf, setCachedPdf } = useIndexedDbPdfCache();
  const memoRef = useRef<Map<string, string>>(new Map());
  const inFlightRenderRef = useRef<Map<string, Promise<string>>>(new Map());
  const inFlightPdfRef = useRef<Map<string, Promise<ArrayBuffer | null>>>(new Map());
  const semaphore = useMemo(() => new RenderSemaphore(MAX_CONCURRENT_RENDERS), []);

  const fetchPdfBinary = useCallback(
    async (docId: string): Promise<ArrayBuffer | null> => {
      const normalizedDocId = docId.trim().toLowerCase();
      const cached = await getCachedPdf(normalizedDocId);
      if (cached) {
        return cached;
      }
      const inFlight = inFlightPdfRef.current.get(normalizedDocId);
      if (inFlight) {
        return inFlight;
      }
      const promise = (async () => {
        try {
          const url = new URL("/api/pdf/proxy", window.location.origin);
          url.searchParams.set("doi", normalizedDocId);
          const response = await fetch(url.toString(), {
            method: "GET",
            headers: { accept: "application/pdf" },
            cache: "no-store"
          });
          if (!response.ok) {
            return null;
          }
          const buffer = await response.arrayBuffer();
          await setCachedPdf(normalizedDocId, buffer);
          return buffer;
        } catch {
          return null;
        } finally {
          inFlightPdfRef.current.delete(normalizedDocId);
        }
      })();
      inFlightPdfRef.current.set(normalizedDocId, promise);
      return promise;
    },
    [getCachedPdf, setCachedPdf]
  );

  const renderSnippet = useCallback(
    async (input: RenderSnippetInput) => {
      if (!isNormRectVisible(input.normRect)) {
        return renderFallbackDataUrl(input.width, input.height);
      }

      const scale = Number.isFinite(input.scale) ? Number(input.scale) : DEFAULT_SCALE;
      const cacheKey = buildSnippetCacheKey({
        docId: input.docId,
        page: input.page,
        normRect: input.normRect,
        scale,
        version: CACHE_VERSION
      });

      const memoHit = memoRef.current.get(cacheKey);
      if (memoHit) {
        return memoHit;
      }

      const inFlightRender = inFlightRenderRef.current.get(cacheKey);
      if (inFlightRender) {
        return inFlightRender;
      }

      const cacheHit = await getCachedSnippet(cacheKey);
      if (cacheHit) {
        memoRef.current.set(cacheKey, cacheHit);
        return cacheHit;
      }

      const renderPromise = semaphore.run(async () => {
        const pdfData = await fetchPdfBinary(input.docId);
        if (!pdfData) {
          const fallback = renderFallbackDataUrl(input.width, input.height);
          memoRef.current.set(cacheKey, fallback);
          await setCachedSnippet(cacheKey, fallback);
          return fallback;
        }

        const request = {
          requestId: `${cacheKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          cacheKey,
          docId: input.docId,
          page: Math.max(1, input.page),
          normRect: input.normRect,
          cssWidth: input.width,
          cssHeight: input.height,
          scale,
          version: CACHE_VERSION,
          dpr: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
          pdfData: pdfData.slice(0)
        };

        const { renderSnippetWithWorker } = await import("../utils/pdf/renderWorkerClient");
        const workerResult = await renderSnippetWithWorker(request);
        let dataUrl = workerResult?.ok ? workerResult.dataUrl ?? "" : "";
        if (!dataUrl) {
          try {
            const { renderSnippetInMainThread } = await import("../utils/pdf/renderSnippetMainThread");
            dataUrl = await renderSnippetInMainThread(request);
          } catch {
            dataUrl = "";
          }
        }

        const finalDataUrl = dataUrl || renderFallbackDataUrl(input.width, input.height);
        memoRef.current.set(cacheKey, finalDataUrl);
        await setCachedSnippet(cacheKey, finalDataUrl);
        return finalDataUrl;
      });
      inFlightRenderRef.current.set(cacheKey, renderPromise);
      try {
        return await renderPromise;
      } finally {
        inFlightRenderRef.current.delete(cacheKey);
      }
    },
    [fetchPdfBinary, getCachedSnippet, semaphore, setCachedSnippet]
  );

  return { renderSnippet };
}

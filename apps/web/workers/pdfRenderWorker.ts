import type { RenderSnippetRequest, RenderSnippetResult, RenderWorkerMessage } from "../types/citation";
import { createCropTransform, normRectToViewportRect } from "../utils/pdf/normRect";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

async function loadPdfJsModule(): Promise<PdfJsModule> {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

async function renderInWorker(payload: RenderSnippetRequest): Promise<string> {
  if (typeof OffscreenCanvas === "undefined") {
    throw new Error("OffscreenCanvas is unavailable");
  }

  const pdfjs = await loadPdfJsModule();
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const dpr = Math.max(1, Number.isFinite(payload.dpr) ? payload.dpr : 1);
  const targetWidth = Math.max(1, Math.floor(payload.cssWidth * dpr));
  const targetHeight = Math.max(1, Math.floor(payload.cssHeight * dpr));
  const renderScale = Math.max(0.25, payload.scale) * dpr;

  const loadingTask = pdfjs.getDocument({
    data: payload.pdfData,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(payload.page);
  const viewport = page.getViewport({ scale: renderScale });
  const cropRect = normRectToViewportRect(payload.normRect, viewport);
  if (cropRect.width < 1 || cropRect.height < 1) {
    throw new Error("Invalid crop size");
  }

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context is unavailable");
  }

  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    transform: createCropTransform(payload.normRect, viewport, targetWidth, targetHeight),
    background: "rgb(255, 255, 255)"
  }).promise;

  const blob = await canvas.convertToBlob({ type: "image/png", quality: 0.94 });
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

self.onmessage = async (event: MessageEvent<RenderWorkerMessage>) => {
  const message = event.data;
  if (!message || message.type !== "render-snippet") {
    return;
  }

  const { payload } = message;
  let response: RenderSnippetResult;
  try {
    const dataUrl = await renderInWorker(payload);
    response = {
      requestId: payload.requestId,
      cacheKey: payload.cacheKey,
      ok: true,
      dataUrl
    };
  } catch (error) {
    response = {
      requestId: payload.requestId,
      cacheKey: payload.cacheKey,
      ok: false,
      error: error instanceof Error ? error.message : "Worker render failed"
    };
  }

  const resultMessage: RenderWorkerMessage = {
    type: "render-snippet-result",
    payload: response
  };
  self.postMessage(resultMessage);
};

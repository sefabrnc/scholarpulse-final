"use client";

import type { RenderSnippetRequest } from "../../types/citation";
import { loadPdfDocument } from "./pdfjsClient";
import { createCropTransform, normRectToViewportRect } from "./normRect";

function encodePngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png", 0.94);
}

export async function renderSnippetInMainThread(request: RenderSnippetRequest): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("Document is unavailable");
  }

  const dpr = Math.max(1, Number.isFinite(request.dpr) ? request.dpr : 1);
  const targetWidth = Math.max(1, Math.floor(request.cssWidth * dpr));
  const targetHeight = Math.max(1, Math.floor(request.cssHeight * dpr));
  const renderScale = Math.max(0.25, request.scale) * dpr;

  const loadingTask = await loadPdfDocument({
    data: request.pdfData,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(request.page);
  const viewport = page.getViewport({ scale: renderScale });
  const cropRect = normRectToViewportRect(request.normRect, viewport);
  if (cropRect.width < 1 || cropRect.height < 1) {
    throw new Error("Invalid crop size");
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context is unavailable");
  }

  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: createCropTransform(request.normRect, viewport, targetWidth, targetHeight),
    background: "rgb(255, 255, 255)"
  }).promise;
  return encodePngDataUrl(canvas);
}

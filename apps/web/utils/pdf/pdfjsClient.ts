"use client";

import type { PDFDocumentLoadingTask } from "pdfjs-dist";

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let workerConfigured = false;
let pdfjsModulePromise: Promise<PdfjsModule> | null = null;

async function getPdfjsModule(): Promise<PdfjsModule> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsModulePromise;
}

function configurePdfjsWorker(pdfjs: PdfjsModule): void {
  if (workerConfigured || typeof window === "undefined") {
    return;
  }
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  workerConfigured = true;
}

export async function loadPdfDocument(
  options: Parameters<PdfjsModule["getDocument"]>[0]
): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await getPdfjsModule();
  configurePdfjsWorker(pdfjs);
  return pdfjs.getDocument(options);
}

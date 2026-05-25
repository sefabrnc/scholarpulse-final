"use client";

import type { RenderSnippetRequest, RenderSnippetResult, RenderWorkerMessage } from "../../types/citation";

const WORKER_POOL_SIZE = 4;
const WORKER_TIMEOUT_MS = 2500;

type PendingRequest = {
  resolve: (value: RenderSnippetResult | null) => void;
  timer: number;
};

const workers: Worker[] = [];
const pendingByRequestId = new Map<string, PendingRequest>();
let workerCursor = 0;

function getNextWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  if (workers.length < WORKER_POOL_SIZE) {
    const worker = new Worker(new URL("../../workers/pdfRenderWorker.ts", import.meta.url));
    worker.addEventListener("message", onWorkerMessage);
    workers.push(worker);
    return worker;
  }
  const worker = workers[workerCursor % workers.length] ?? null;
  workerCursor = (workerCursor + 1) % Math.max(1, workers.length);
  return worker;
}

function clearPendingRequest(requestId: string): PendingRequest | null {
  const pending = pendingByRequestId.get(requestId) ?? null;
  if (!pending) {
    return null;
  }
  window.clearTimeout(pending.timer);
  pendingByRequestId.delete(requestId);
  return pending;
}

function onWorkerMessage(event: MessageEvent<RenderWorkerMessage>) {
  const message = event.data;
  if (!message || message.type !== "render-snippet-result") {
    return;
  }
  const pending = clearPendingRequest(message.payload.requestId);
  pending?.resolve(message.payload);
}

export async function renderSnippetWithWorker(
  request: RenderSnippetRequest
): Promise<RenderSnippetResult | null> {
  const worker = getNextWorker();
  if (!worker) {
    return null;
  }
  const requestId = request.requestId;
  const payload: RenderWorkerMessage = {
    type: "render-snippet",
    payload: request
  };

  return new Promise<RenderSnippetResult | null>((resolve) => {
    const timer = window.setTimeout(() => {
      pendingByRequestId.delete(requestId);
      resolve(null);
    }, WORKER_TIMEOUT_MS);
    pendingByRequestId.set(requestId, { resolve, timer });
    worker.postMessage(payload, [request.pdfData]);
  });
}

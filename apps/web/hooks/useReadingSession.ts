"use client";

import { useCallback, useEffect, useRef } from "react";
import { apiPost } from "../lib/api/client";

type UseReadingSessionOptions = {
  doi: string;
  pageNumber: number;
  enabled?: boolean;
  debounceMs?: number;
};

export function useReadingSession(options: UseReadingSessionOptions) {
  const { doi, pageNumber, enabled = true, debounceMs = 5000 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ lastPage: number; scrollY: number; deltaSeconds: number } | null>(null);
  const lastTickRef = useRef<number>(Date.now());

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || !enabled || !doi.trim()) {
      return;
    }
    pendingRef.current = null;
    try {
      await apiPost("/api/sessions/update", {
        doi,
        last_page: pending.lastPage,
        scroll_y: pending.scrollY,
        delta_seconds: pending.deltaSeconds
      });
    } catch {
      // non-blocking; desk reading should continue
    }
    lastTickRef.current = Date.now();
  }, [doi, enabled]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      flush().catch(() => {
        // flush handles errors
      });
    }, debounceMs);
  }, [debounceMs, flush]);

  const reportScroll = useCallback(
    (scrollY: number) => {
      if (!enabled || !doi.trim()) {
        return;
      }
      const now = Date.now();
      const deltaSeconds = Math.max(0, (now - lastTickRef.current) / 1000);
      pendingRef.current = {
        lastPage: pageNumber,
        scrollY: Math.min(1, Math.max(0, scrollY)),
        deltaSeconds: (pendingRef.current?.deltaSeconds ?? 0) + deltaSeconds
      };
      lastTickRef.current = now;
      scheduleFlush();
    },
    [doi, enabled, pageNumber, scheduleFlush]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      const pending = pendingRef.current;
      if (pending && enabled && doi.trim()) {
        apiPost("/api/sessions/update", {
          doi,
          last_page: pending.lastPage,
          scroll_y: pending.scrollY,
          delta_seconds: pending.deltaSeconds
        }).catch(() => {
          // best-effort on unmount
        });
      }
    };
  }, [doi, enabled]);

  return { reportScroll, flush };
}

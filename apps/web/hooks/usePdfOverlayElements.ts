"use client";

import { useEffect, useState } from "react";
import type { PdfOverlayElement, PdfOverlayResponse } from "../types/citation";

type OverlayState = {
  items: PdfOverlayElement[];
  isLoading: boolean;
  error: string | null;
};

const DEFAULT_STATE: OverlayState = {
  items: [],
  isLoading: false,
  error: null
};

export function usePdfOverlayElements(doi: string, page: number) {
  const [state, setState] = useState<OverlayState>(DEFAULT_STATE);

  useEffect(() => {
    if (!doi) {
      setState(DEFAULT_STATE);
      return;
    }

    let active = true;
    const run = async () => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const params = new URLSearchParams({ doi, page: String(page) });
        const response = await fetch(`/api/cite/elements?${params.toString()}`, {
          method: "GET",
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`Overlay request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as PdfOverlayResponse;
        if (!active) {
          return;
        }
        setState({
          items: payload.items ?? [],
          isLoading: false,
          error: null
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setState({
          items: [],
          isLoading: false,
          error: error instanceof Error ? error.message : "Overlay request failed"
        });
      }
    };

    run().catch(() => {
      // run() sets error state on failure
    });
    return () => {
      active = false;
    };
  }, [doi, page]);

  return state;
}

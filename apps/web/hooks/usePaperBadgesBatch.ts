"use client";

import { useEffect, useMemo, useState } from "react";
import type { PaperBadgeData } from "./usePaperBadge";

type BatchState = {
  byDoi: Record<string, PaperBadgeData>;
  loading: boolean;
};

const EMPTY: BatchState = { byDoi: {}, loading: false };

function normalizeDoiKey(doi: string): string {
  return doi.trim().toLowerCase();
}

export function usePaperBadgesBatch(dois: string[]) {
  const doiKey = useMemo(
    () =>
      [...new Set(dois.map((doi) => doi.trim()).filter(Boolean))]
        .slice(0, 20)
        .sort()
        .join("|"),
    [dois]
  );
  const [state, setState] = useState<BatchState>(EMPTY);

  useEffect(() => {
    const uniqueDois = doiKey.length > 0 ? doiKey.split("|") : [];
    if (uniqueDois.length === 0) {
      setState(EMPTY);
      return;
    }

    let alive = true;
    setState({ byDoi: {}, loading: true });

    (async () => {
      try {
        const response = await fetch("/api/papers/badges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dois: uniqueDois }),
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`Badge batch request failed (${response.status})`);
        }
        const payload = (await response.json()) as { badges?: PaperBadgeData[] };
        if (!alive) {
          return;
        }
        const byDoi: Record<string, PaperBadgeData> = {};
        for (const badge of payload.badges ?? []) {
          if (badge?.doi) {
            byDoi[normalizeDoiKey(badge.doi)] = badge;
          }
        }
        setState({ byDoi, loading: false });
      } catch {
        if (!alive) {
          return;
        }
        setState({ byDoi: {}, loading: false });
      }
    })();

    return () => {
      alive = false;
    };
  }, [doiKey]);

  return state;
}

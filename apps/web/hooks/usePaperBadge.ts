"use client";

import { useEffect, useState } from "react";

export type PaperBadgeData = {
  doi: string;
  title: string | null;
  citation_count: number;
  influential_count: number;
  supports: number;
  contradicts: number;
  extends: number;
  method: number;
  data: number;
  mentions: number;
};

type BadgeState = {
  data: PaperBadgeData | null;
  loading: boolean;
  error: string | null;
};

const EMPTY: BadgeState = { data: null, loading: false, error: null };

export function usePaperBadge(doi: string | null | undefined) {
  const [state, setState] = useState<BadgeState>(EMPTY);

  useEffect(() => {
    const normalized = doi?.trim();
    if (!normalized) {
      setState(EMPTY);
      return;
    }

    let alive = true;
    setState({ data: null, loading: true, error: null });

    (async () => {
      try {
        const response = await fetch(`/api/papers/${encodeURIComponent(normalized)}/badge`, {
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`Badge request failed (${response.status})`);
        }
        const payload = (await response.json()) as PaperBadgeData & { ok?: boolean };
        if (!alive) {
          return;
        }
        setState({ data: payload, loading: false, error: null });
      } catch (cause) {
        if (!alive) {
          return;
        }
        setState({
          data: null,
          loading: false,
          error: cause instanceof Error ? cause.message : "Badge request failed"
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [doi]);

  return state;
}

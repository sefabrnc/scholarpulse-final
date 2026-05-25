"use client";

import { useEffect, useMemo, useState } from "react";
import type { PaperBadgeData } from "./usePaperBadge";

type BadgesState = {
  byDoi: Record<string, PaperBadgeData>;
  loading: boolean;
  error: string | null;
};

const EMPTY: BadgesState = { byDoi: {}, loading: false, error: null };

export function usePaperBadges(dois: string[]) {
  const normalized = useMemo(
    () => Array.from(new Set(dois.map((doi) => doi.trim()).filter(Boolean))).slice(0, 50),
    [dois]
  );
  const key = normalized.join("|");
  const [state, setState] = useState<BadgesState>(EMPTY);

  useEffect(() => {
    if (normalized.length === 0) {
      setState(EMPTY);
      return;
    }

    let alive = true;
    setState({ byDoi: {}, loading: true, error: null });

    (async () => {
      try {
        const response = await fetch(
          `/api/papers/badges?dois=${encodeURIComponent(normalized.join(","))}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error(`Badge batch request failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          items?: PaperBadgeData[];
        };
        if (!alive) {
          return;
        }
        const byDoi: Record<string, PaperBadgeData> = {};
        for (const item of payload.items ?? []) {
          if (item.doi) {
            byDoi[item.doi] = item;
          }
        }
        setState({ byDoi, loading: false, error: null });
      } catch (cause) {
        if (!alive) {
          return;
        }
        setState({
          byDoi: {},
          loading: false,
          error: cause instanceof Error ? cause.message : "Badge batch request failed"
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [key, normalized]);

  return state;
}

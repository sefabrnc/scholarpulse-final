"use client";

import { useCallback, useState } from "react";
import type { CitationMarker, TimelineResponse, UserTier } from "../types/citation";

type TimelineState = {
  data: TimelineResponse | null;
  isLoading: boolean;
  error: string | null;
};

const DEFAULT_STATE: TimelineState = {
  data: null,
  isLoading: false,
  error: null
};

export function useTimeline() {
  const [state, setState] = useState<TimelineState>(DEFAULT_STATE);

  const fetchTimeline = useCallback(async (marker: CitationMarker, tier: UserTier) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const params = new URLSearchParams({
        id: marker.id,
        plan: tier
      });
      const response = await fetch(`/api/cite/timeline?${params.toString()}`, {
        method: "GET",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Timeline request failed with status ${response.status}`);
      }
      const payload = (await response.json()) as TimelineResponse;
      setState({
        data: payload,
        isLoading: false,
        error: null
      });
      return payload;
    } catch (error) {
      setState({
        data: null,
        isLoading: false,
        error: error instanceof Error ? error.message : "Timeline request failed"
      });
      return null;
    }
  }, []);

  return {
    data: state.data,
    isLoading: state.isLoading,
    error: state.error,
    fetchTimeline
  };
}

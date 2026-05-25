"use client";

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api/client";

export type AnnotationItem = {
  id: string;
  doi: string;
  page: number;
  norm_x: number;
  norm_y: number;
  norm_w: number;
  norm_h: number;
  color?: string;
  note?: string | null;
};

type CreateAnnotationInput = {
  page: number;
  norm_x: number;
  norm_y: number;
  norm_w: number;
  norm_h: number;
  color?: string;
  note?: string;
};

export function useAnnotations(doi: string, page?: number) {
  const [items, setItems] = useState<AnnotationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!doi.trim()) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const pageSuffix = typeof page === "number" ? `&page=${page}` : "";
      const response = await apiGet<{ items?: AnnotationItem[] }>(
        `/api/annotations?doi=${encodeURIComponent(doi)}${pageSuffix}`
      );
      setItems(response.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Annotations request failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [doi, page]);

  useEffect(() => {
    reload().catch(() => {
      // reload sets error state
    });
  }, [reload]);

  const createAnnotation = useCallback(
    async (input: CreateAnnotationInput) => {
      await apiPost("/api/annotations", {
        doi,
        page: input.page,
        norm_x: input.norm_x,
        norm_y: input.norm_y,
        norm_w: input.norm_w,
        norm_h: input.norm_h,
        color: input.color ?? "yellow",
        note: input.note
      });
      await reload();
    },
    [doi, reload]
  );

  const updateAnnotation = useCallback(
    async (id: string, note: string) => {
      await apiPatch(`/api/annotations/${encodeURIComponent(id)}`, { note });
      await reload();
    },
    [reload]
  );

  const removeAnnotation = useCallback(
    async (id: string) => {
      await apiDelete(`/api/annotations/${encodeURIComponent(id)}`);
      await reload();
    },
    [reload]
  );

  return {
    items,
    loading,
    error,
    reload,
    createAnnotation,
    updateAnnotation,
    removeAnnotation
  };
}

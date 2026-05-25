"use client";

import { useEffect, useMemo, useState } from "react";
import type { TimelineItem } from "../../types/citation";
import { useLazyRender } from "../../hooks/useLazyRender";
import { usePdfSnippetRenderer } from "../../hooks/usePdfSnippetRenderer";
import { buildSnippetCacheKey, isNormRectVisible } from "../../utils/pdf/normRect";

type TimelineSnippetPreviewProps = {
  item: TimelineItem;
};

const WIDTH = 248;
const HEIGHT = 94;

export function TimelineSnippetPreview(props: TimelineSnippetPreviewProps) {
  const { ref, visible } = useLazyRender();
  const { renderSnippet } = usePdfSnippetRenderer();
  const [imageSrc, setImageSrc] = useState<string>("");
  const [renderedKey, setRenderedKey] = useState<string>("");

  const renderKey = useMemo(() => {
    const doi = props.item.doiNorm ?? "no-doi";
    const page = props.item.page ?? 1;
    const rect = props.item.normRect;
    if (!rect) {
      return `${doi}|${page}|empty|v2`;
    }
    return buildSnippetCacheKey({
      docId: doi,
      page,
      normRect: rect,
      scale: 1.35,
      version: "snippet-v2"
    });
  }, [props.item.doiNorm, props.item.normRect, props.item.page]);

  useEffect(() => {
    if (renderedKey === renderKey) {
      return;
    }
    setImageSrc("");
  }, [renderKey, renderedKey]);

  useEffect(() => {
    const rect = props.item.normRect;
    const doi = props.item.doiNorm ?? "no-doi";
    const page = props.item.page ?? 1;
    if (!visible || renderedKey === renderKey || !rect || !isNormRectVisible(rect)) {
      return;
    }
    let active = true;
    const debounceTimer = window.setTimeout(() => {
      renderSnippet({
        docId: doi,
        page,
        normRect: rect,
        width: WIDTH,
        height: HEIGHT,
        scale: 1.35
      }).then((result) => {
        if (!active) {
          return;
        }
        setImageSrc(result);
        setRenderedKey(renderKey);
      }).catch(() => {
        // Snippet preview is best-effort; card keeps placeholder state
      });
    }, 60);
    return () => {
      active = false;
      window.clearTimeout(debounceTimer);
    };
  }, [props.item.doiNorm, props.item.normRect, props.item.page, renderKey, renderSnippet, renderedKey, visible]);

  return (
    <div ref={ref} className="timeline-snippet-preview">
      {imageSrc ? (
        <img src={imageSrc} alt="Snippet preview" width={WIDTH} height={HEIGHT} loading="lazy" />
      ) : (
        <div className="timeline-snippet-fallback">Lazy snippet preview</div>
      )}
    </div>
  );
}

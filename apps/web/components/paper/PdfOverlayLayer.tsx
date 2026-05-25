"use client";

import type { NormRect, PdfOverlayElement } from "../../types/citation";

type PdfOverlayLayerProps = {
  elements: PdfOverlayElement[];
  viewport: {
    width: number;
    height: number;
    pageNumber: number;
  };
  activeElementId?: string | null;
  crossLinked?: boolean;
  onElementClick: (element: PdfOverlayElement) => void;
  onElementHoverChange?: (active: boolean) => void;
};

function rectStyle(rect: NormRect, viewport: PdfOverlayLayerProps["viewport"]) {
  void viewport;
  return {
    left: `${Math.max(0, Math.min(1, rect.x)) * 100}%`,
    top: `${Math.max(0, Math.min(1, rect.y)) * 100}%`,
    width: `${Math.max(0, Math.min(1, rect.width)) * 100}%`,
    height: `${Math.max(0, Math.min(1, rect.height)) * 100}%`
  };
}

export function PdfOverlayLayer(props: PdfOverlayLayerProps) {
  if (props.elements.length === 0) {
    return null;
  }

  return (
    <div className="pdf-overlay-layer" aria-label={`Overlay page ${props.viewport.pageNumber}`}>
      {props.elements.map((element) => {
        const isActive = props.activeElementId === element.sentenceId;
        return (
          <button
            key={element.sentenceId}
            type="button"
            onClick={() => props.onElementClick(element)}
            onMouseEnter={() => props.onElementHoverChange?.(true)}
            onMouseLeave={() => props.onElementHoverChange?.(false)}
            className={`pdf-overlay-item type-${element.elementType}${isActive ? " active" : ""}${
              props.crossLinked ? " linked" : ""
            }`}
            style={rectStyle(element.normRect, props.viewport)}
            title={`${element.elementLabel} (${element.elementType})`}
            aria-label={`${element.elementLabel} (${element.elementType})`}
          >
            <span>{element.elementLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

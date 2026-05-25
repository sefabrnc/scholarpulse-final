"use client";

import type { RefObject } from "react";
import type { NormRect } from "../../types/citation";
import type { PdfOverlayElement } from "../../types/citation";
import type { AnnotationItem } from "../../hooks/useAnnotations";
import { AnnotationOverlayLayer } from "./AnnotationOverlayLayer";
import { PdfOverlayLayer } from "./PdfOverlayLayer";

type DocumentPaneProps = {
  title: string;
  subtitle: string;
  pageNumber?: number;
  highlightRect?: NormRect | null;
  linkedActive?: boolean;
  onHighlightHoverChange?: (active: boolean) => void;
  overlayElements?: PdfOverlayElement[];
  activeOverlayElementId?: string | null;
  onOverlayElementClick?: (element: PdfOverlayElement) => void;
  onOverlayHoverChange?: (active: boolean) => void;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
  annotations?: AnnotationItem[];
  onAnnotationSelect?: (annotation: AnnotationItem) => void;
  annotationCreateMode?: boolean;
  onAnnotationCreateAt?: (point: { x: number; y: number }) => void;
};

export function DocumentPane(props: DocumentPaneProps) {
  const overlay = props.highlightRect;

  return (
    <section className="panel-card doc-pane">
      <h3>{props.title}</h3>
      <p className="doc-subtitle">{props.subtitle}</p>
      <div
        ref={props.scrollRef}
        className="pdf-placeholder pdf-scrollable"
        onScroll={props.onScroll}
      >
        <div className="pdf-page-content">
          <div className="pdf-line" style={{ width: "68%" }} />
          <div className="pdf-line" style={{ width: "81%" }} />
          <div className="pdf-line" style={{ width: "74%" }} />
          <div className="pdf-line" style={{ width: "57%" }} />
          <div className="pdf-line" style={{ width: "63%" }} />
          <div className="pdf-line" style={{ width: "79%" }} />
          <div className="pdf-line" style={{ width: "66%" }} />
          <div className="pdf-line" style={{ width: "72%" }} />
          <div className="pdf-line" style={{ width: "58%" }} />
          <div className="pdf-line" style={{ width: "80%" }} />
        </div>
        {overlay ? (
          <button
            type="button"
            title="Citation highlight"
            aria-label="Citation highlight"
            onMouseEnter={() => props.onHighlightHoverChange?.(true)}
            onMouseLeave={() => props.onHighlightHoverChange?.(false)}
            className={`pdf-highlight${props.linkedActive ? " linked" : ""}`}
            style={{
              left: `${overlay.x * 100}%`,
              top: `${overlay.y * 100}%`,
              width: `${overlay.width * 100}%`,
              height: `${overlay.height * 100}%`
            }}
          />
        ) : null}
        {props.annotations && props.annotations.length > 0 ? (
          <AnnotationOverlayLayer
            annotations={props.annotations}
            onSelect={props.onAnnotationSelect}
            creating={props.annotationCreateMode}
            onCreateAt={props.onAnnotationCreateAt}
          />
        ) : props.annotationCreateMode ? (
          <AnnotationOverlayLayer
            annotations={[]}
            creating
            onCreateAt={props.onAnnotationCreateAt}
          />
        ) : null}
        {props.overlayElements && props.overlayElements.length > 0 && props.onOverlayElementClick ? (
          <PdfOverlayLayer
            elements={props.overlayElements}
            viewport={{
              width: 1000,
              height: 1400,
              pageNumber: props.pageNumber ?? 1
            }}
            activeElementId={props.activeOverlayElementId}
            crossLinked={props.linkedActive}
            onElementClick={props.onOverlayElementClick}
            onElementHoverChange={props.onOverlayHoverChange}
          />
        ) : null}
      </div>
    </section>
  );
}

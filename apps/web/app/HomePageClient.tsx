"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContinueReading } from "../components/library/ContinueReading";
import { AnnotationNotePopup } from "../components/paper/AnnotationOverlayLayer";
import { DocumentPane } from "../components/paper/DocumentPane";
import { MarkerTextBlock } from "../components/paper/MarkerTextBlock";
import { TimelineTab } from "../components/timeline/TimelineTab";
import { useAnnotations, type AnnotationItem } from "../hooks/useAnnotations";
import { usePdfOverlayElements } from "../hooks/usePdfOverlayElements";
import { useReadingSession } from "../hooks/useReadingSession";
import { useTimeline } from "../hooks/useTimeline";
import type { CitationMarker, PdfOverlayElement, TimelineItem, UserTier } from "../types/citation";

const SAMPLE_BLOCKS = [
  "We adopt the encoder-decoder backbone described in [12,15-17] and compare it with the improvements described by (Smith 2020).",
  "The transfer result remains close to [Zhang et al.] in low-resource settings while keeping a stable loss trend.",
  "A direct baseline comparison against [12] shows that the convergence gap is mainly due to tokenization."
];

export default function HomePageClient() {
  const [tier, setTier] = useState<UserTier>("free");
  const [highConfidenceOnly, setHighConfidenceOnly] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<CitationMarker | null>(null);
  const [selectedCard, setSelectedCard] = useState<TimelineItem | null>(null);
  const [hoveredSide, setHoveredSide] = useState<"source" | "target" | null>(null);
  const [selectedOverlayElementId, setSelectedOverlayElementId] = useState<string | null>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<AnnotationItem | null>(null);
  const [annotationCreateMode, setAnnotationCreateMode] = useState(false);
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error, fetchTimeline } = useTimeline();
  const sourceDoi = "10.5555/sample-source";
  const sourcePageNumber = 1;
  const {
    items: annotations,
    createAnnotation,
    updateAnnotation,
    removeAnnotation
  } = useAnnotations(sourceDoi, sourcePageNumber);
  const { reportScroll } = useReadingSession({
    doi: sourceDoi,
    pageNumber: sourcePageNumber,
    enabled: true
  });
  const {
    items: overlayElements,
    isLoading: overlayLoading,
    error: overlayError
  } = usePdfOverlayElements(sourceDoi, sourcePageNumber);

  useEffect(() => {
    if (!selectedMarker) {
      return;
    }
    fetchTimeline(selectedMarker, tier).catch(() => {
      // fetchTimeline updates hook error state
    });
  }, [fetchTimeline, selectedMarker, tier]);

  const splitOpen = Boolean(selectedCard);

  const markerSubtitle = useMemo(() => {
    if (!selectedMarker) {
      return "Choose a citation marker in the left paper text.";
    }
    return `Selected marker ${selectedMarker.label}`;
  }, [selectedMarker]);

  const handleMarkerClick = (marker: CitationMarker) => {
    setSelectedMarker(marker);
    setSelectedCard(null);
    setHoveredSide(null);
    setSelectedOverlayElementId(null);
    fetchTimeline(marker, tier).catch(() => {
      // fetchTimeline updates hook error state
    });
  };

  const handleOverlayClick = (element: PdfOverlayElement) => {
    setSelectedOverlayElementId(element.sentenceId);
    setSelectedCard(null);
    setHoveredSide(null);
    const syntheticMarker: CitationMarker = {
      id: element.sentenceId,
      key: element.sentenceId,
      label: element.elementLabel,
      start: 0,
      end: 0,
      kind: "numeric-bracket",
      normRect: element.normRect
    };
    setSelectedMarker(syntheticMarker);
    fetchTimeline(syntheticMarker, tier).catch(() => {
      // fetchTimeline updates hook error state
    });
  };

  const handleTimelineCardClick = (card: TimelineItem) => {
    setSelectedCard(card);
  };

  const linkedActive = hoveredSide !== null;

  const handleSourceScroll = useCallback(() => {
    const node = sourceScrollRef.current;
    if (!node) {
      return;
    }
    const maxScroll = node.scrollHeight - node.clientHeight;
    const scrollY = maxScroll > 0 ? node.scrollTop / maxScroll : 0;
    reportScroll(scrollY);
  }, [reportScroll]);

  const handleCreateAnnotationAt = useCallback(
    async (point: { x: number; y: number }) => {
      const note = window.prompt("Annotation note (optional)") ?? "";
      await createAnnotation({
        page: sourcePageNumber,
        norm_x: Math.min(0.9, Math.max(0, point.x - 0.1)),
        norm_y: Math.min(0.9, Math.max(0, point.y - 0.02)),
        norm_w: 0.2,
        norm_h: 0.04,
        color: "yellow",
        note: note.trim() || undefined
      });
      setAnnotationCreateMode(false);
    },
    [createAnnotation, sourcePageNumber]
  );

  return (
    <main className="desk-shell">
      <section className="desk-main">
        <header className="panel-card" style={{ padding: 12 }}>
          <h1 style={{ margin: "0 0 8px" }}>ScholarPulse Desk (minimal flow)</h1>
          <p className="muted" style={{ margin: 0 }}>
            Marker click fetches timeline, timeline card click opens split-view placeholder.
          </p>
        </header>

        <section className="panel-card" style={{ padding: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Continue reading</h2>
          <ContinueReading limit={3} compact />
        </section>

        <section className="panel-card" style={{ padding: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Paper text block</h2>
          <p className="muted">{markerSubtitle}</p>
          {overlayLoading ? <p className="muted">Loading figure/table/image overlays...</p> : null}
          {overlayError ? <p className="muted">Overlay fallback active: {overlayError}</p> : null}
          {SAMPLE_BLOCKS.map((text, index) => (
            <MarkerTextBlock
              key={`block-${index}`}
              text={text}
              activeMarkerId={selectedMarker?.id}
              onMarkerClick={handleMarkerClick}
            />
          ))}
        </section>

        <section className={`workspace-grid${splitOpen ? "" : " single"}`}>
          <DocumentPane
            title="Source document"
            subtitle="Left pane - marker, annotations, session tracking"
            pageNumber={sourcePageNumber}
            highlightRect={selectedMarker?.normRect}
            linkedActive={linkedActive}
            onHighlightHoverChange={(active) => setHoveredSide(active ? "source" : null)}
            overlayElements={overlayElements}
            activeOverlayElementId={selectedOverlayElementId}
            onOverlayElementClick={handleOverlayClick}
            onOverlayHoverChange={(active) => setHoveredSide(active ? "source" : null)}
            scrollRef={sourceScrollRef}
            onScroll={handleSourceScroll}
            annotations={annotations}
            onAnnotationSelect={setActiveAnnotation}
            annotationCreateMode={annotationCreateMode}
            onAnnotationCreateAt={(point) => {
              handleCreateAnnotationAt(point).catch(() => {
                // createAnnotation surfaces via hook state on notes page; desk stays non-blocking
              });
            }}
          />
          {splitOpen ? (
            <DocumentPane
              title="Target document"
              subtitle={`${selectedCard?.title ?? "Timeline target"} - page ${selectedCard?.page ?? "n/a"}`}
              pageNumber={selectedCard?.page ?? 1}
              highlightRect={selectedCard?.normRect}
              linkedActive={linkedActive}
              onHighlightHoverChange={(active) => setHoveredSide(active ? "target" : null)}
            />
          ) : null}
        </section>
      </section>

      <aside className="side-panel">
        <div className="tabs">
          <span className="tab active">Timeline</span>
          <button
            type="button"
            className={`tab tab-button${annotationCreateMode ? " active" : ""}`}
            onClick={() => setAnnotationCreateMode((value) => !value)}
          >
            {annotationCreateMode ? "Click PDF..." : "Add note"}
          </button>
        </div>
        <AnnotationNotePopup
          annotation={activeAnnotation}
          onClose={() => setActiveAnnotation(null)}
          onSave={updateAnnotation}
          onDelete={removeAnnotation}
        />
        <TimelineTab
          marker={selectedMarker}
          tier={tier}
          onTierChange={setTier}
          data={data}
          isLoading={isLoading}
          error={error}
          onCardClick={handleTimelineCardClick}
          highConfidenceOnly={highConfidenceOnly}
        />
        <label className="row" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={highConfidenceOnly}
            onChange={(event) => setHighConfidenceOnly(event.target.checked)}
          />
          <span className="muted-small">Show only high confidence</span>
        </label>
      </aside>
    </main>
  );
}

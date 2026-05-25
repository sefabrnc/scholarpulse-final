"use client";

import { useMemo } from "react";
import type { CitationMarker } from "../../types/citation";
import { parseCitationMarkers, splitTextByMarkers } from "../../utils/citeMarkers";

type MarkerTextBlockProps = {
  text: string;
  activeMarkerId?: string;
  onMarkerClick: (marker: CitationMarker) => void;
};

export function MarkerTextBlock(props: MarkerTextBlockProps) {
  const markers = useMemo(() => parseCitationMarkers(props.text), [props.text]);
  const segments = useMemo(() => splitTextByMarkers(props.text, markers), [props.text, markers]);

  return (
    <p>
      {segments.map((segment, index) => {
        if (!segment.marker) {
          return <span key={`text-${index}`}>{segment.text}</span>;
        }
        const isActive = segment.marker.id === props.activeMarkerId;
        return (
          <button
            key={segment.marker.id}
            type="button"
            className={`marker-button${isActive ? " active" : ""}`}
            title="Show timeline"
            onClick={() => props.onMarkerClick(segment.marker!)}
          >
            {segment.text}
          </button>
        );
      })}
    </p>
  );
}

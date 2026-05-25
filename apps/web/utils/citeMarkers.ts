import type { CitationMarker, MarkerKind, TextSegment } from "../types/citation";

type PatternDef = {
  kind: MarkerKind;
  regex: RegExp;
};

const PATTERNS: PatternDef[] = [
  {
    kind: "numeric-range",
    regex: /\[(?:\d+(?:\s*-\s*\d+)?)(?:\s*,\s*\d+(?:\s*-\s*\d+)?)+\]/g
  },
  {
    kind: "numeric-bracket",
    regex: /\[\d+\]/g
  },
  {
    kind: "author-year",
    regex: /\([A-Z][A-Za-z]+(?:\s+et\s+al\.)?(?:,\s*)?\s+\d{4}[a-z]?\)/g
  },
  {
    kind: "author-bracket",
    regex: /\[[A-Z][A-Za-z]+(?:\s+et\s+al\.)?\]/g
  }
];

function derivePseudoRect(index: number): CitationMarker["normRect"] {
  const lane = index % 6;
  return {
    x: 0.09 + (index % 3) * 0.17,
    y: 0.12 + lane * 0.11,
    width: 0.32,
    height: 0.07
  };
}

export function parseCitationMarkers(text: string): CitationMarker[] {
  const matches: CitationMarker[] = [];

  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match = regex.exec(text);
    while (match) {
      const value = match[0];
      const start = match.index;
      const end = start + value.length;
      matches.push({
        id: `marker-${start}-${end}`,
        key: value.replace(/\s+/g, " ").trim(),
        label: value,
        start,
        end,
        kind: pattern.kind,
        normRect: derivePseudoRect(matches.length)
      });
      match = regex.exec(text);
    }
  }

  matches.sort((a, b) => a.start - b.start || a.end - b.end);

  const filtered: CitationMarker[] = [];
  for (const marker of matches) {
    const overlap = filtered.some(
      (existing) => marker.start < existing.end && marker.end > existing.start
    );
    if (!overlap) {
      filtered.push(marker);
    }
  }
  return filtered;
}

export function splitTextByMarkers(text: string, markers: CitationMarker[]): TextSegment[] {
  if (markers.length === 0) {
    return [{ text }];
  }

  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const marker of markers) {
    if (marker.start > cursor) {
      segments.push({ text: text.slice(cursor, marker.start) });
    }
    segments.push({
      text: marker.label,
      marker
    });
    cursor = marker.end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments;
}

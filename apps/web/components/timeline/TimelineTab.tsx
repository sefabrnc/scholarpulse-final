"use client";

import type { CitationMarker, TimelineItem, TimelineResponse, UserTier } from "../../types/citation";
import { TimelineIntentBadge } from "./TimelineIntentBadge";
import { TimelineReportButton } from "./TimelineReportButton";
import { TimelineSnippetPreview } from "./TimelineSnippetPreview";

type TimelineTabProps = {
  marker: CitationMarker | null;
  tier: UserTier;
  onTierChange: (tier: UserTier) => void;
  data: TimelineResponse | null;
  isLoading: boolean;
  error: string | null;
  onCardClick: (item: TimelineItem) => void;
  highConfidenceOnly?: boolean;
};

function isHighConfidence(item: { confidenceTier?: string | null; ceScore?: number | null }): boolean {
  const tier = (item.confidenceTier ?? "").toLowerCase();
  if (tier === "high") {
    return true;
  }
  return (item.ceScore ?? 0) >= 0.95;
}

export function TimelineTab(props: TimelineTabProps) {
  const tierLimit = props.data?.tierLimit ?? (props.tier === "pro" ? 100 : 10);
  const rawItems = props.data?.items ?? [];
  const visibleItems = props.highConfidenceOnly ? rawItems.filter((item) => isHighConfidence(item)) : rawItems;
  const itemCount = visibleItems.length;

  return (
    <section>
      <div className="tier-row">
        <div>
          <strong>Timeline</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            Marker: {props.marker?.label ?? "-"}
          </div>
        </div>
        <div className="tier-switch">
          <button
            type="button"
            className={props.tier === "free" ? "active" : ""}
            onClick={() => props.onTierChange("free")}
          >
            Free
          </button>
          <button
            type="button"
            className={props.tier === "pro" ? "active" : ""}
            onClick={() => props.onTierChange("pro")}
          >
            Pro
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Showing {itemCount} / {tierLimit} cards ({props.tier})
        {props.highConfidenceOnly ? " - high confidence only" : ""}
      </p>

      {props.isLoading ? <p>Loading timeline...</p> : null}
      {props.error ? <p style={{ color: "#b91c1c" }}>{props.error}</p> : null}
      {!props.marker ? <p className="muted">Click a citation marker in the text.</p> : null}

      <div className="timeline-list">
        {visibleItems.map((item, index) => (
          <article
            key={`${item.edgeId}-${index}`}
            className={`timeline-card${item.isInfluential ? " timeline-card-influential" : ""}`}
          >
            <div style={{ fontWeight: 600 }}>
              {item.publicationYear ?? "n/a"} - {item.title}
            </div>
            <TimelineIntentBadge
              relationType={item.relationType ?? item.edgeType}
              confidenceTier={item.confidenceTier}
              isInfluential={item.isInfluential}
            />
            <TimelineSnippetPreview item={item} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {item.venue ?? "Unknown venue"} - {item.direction}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              page {item.page ?? "n/a"} - ce {item.ceScore?.toFixed(2) ?? "n/a"}
              {item.refLabel ? ` - ref ${item.refLabel}` : ""}
            </div>
            <div className="timeline-card-actions">
              <button type="button" onClick={() => props.onCardClick(item)}>
                Open split view
              </button>
              <TimelineReportButton edgeId={item.edgeId} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

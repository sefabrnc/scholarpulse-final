"use client";

export type CitationIntent =
  | "supports"
  | "contradicts"
  | "extends"
  | "method"
  | "data"
  | "mentions";

type TimelineIntentBadgeProps = {
  relationType: string | null | undefined;
  confidenceTier?: string | null;
  isInfluential?: boolean;
};

const INTENT_CLASS: Record<string, string> = {
  supports: "intent-supports",
  contradicts: "intent-contradicts",
  extends: "intent-extends",
  method: "intent-method",
  data: "intent-data",
  mentions: "intent-mentions"
};

const TIER_CLASS: Record<string, string> = {
  high: "tier-high",
  medium: "tier-medium",
  low: "tier-low"
};

export function TimelineIntentBadge(props: TimelineIntentBadgeProps) {
  const relation = (props.relationType ?? "mentions").toLowerCase();
  const intentClass = INTENT_CLASS[relation] ?? INTENT_CLASS.mentions;
  const tier = (props.confidenceTier ?? "high").toLowerCase();
  const tierClass = TIER_CLASS[tier] ?? TIER_CLASS.high;

  return (
    <div className="timeline-badge-row">
      <span className={`intent-badge ${intentClass}`}>{relation.toUpperCase()}</span>
      <span className={`tier-badge ${tierClass}`}>{tier}</span>
      {props.isInfluential ? <span className="influential-badge">Influential</span> : null}
    </div>
  );
}

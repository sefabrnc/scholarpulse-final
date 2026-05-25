type InfluentialBadgeProps = {
  count: number;
  compact?: boolean;
  title?: string;
};

export function InfluentialBadge(props: InfluentialBadgeProps) {
  if (props.count <= 0) {
    return null;
  }

  const label = props.compact
    ? String(props.count)
    : `${props.count} influential cite${props.count === 1 ? "" : "s"}`;

  return (
    <span className="influential-badge" title={props.title ?? "High-confidence or supporting/extending citations"}>
      Influential {label}
    </span>
  );
}

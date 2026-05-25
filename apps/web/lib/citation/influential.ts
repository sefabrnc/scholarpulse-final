import type { TimelineItem } from "../../types/citation";

const INFLUENTIAL_EDGE_TYPES = new Set(["supports", "extends"]);

export function isInfluentialCite(item: Pick<TimelineItem, "ceScore" | "edgeType">): boolean {
  const ceScore = item.ceScore ?? 0;
  if (ceScore >= 0.95) {
    return true;
  }
  const edgeType = (item.edgeType ?? "").toLowerCase();
  return INFLUENTIAL_EDGE_TYPES.has(edgeType);
}

export function sortTimelineInfluentialFirst(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    const aInf = isInfluentialCite(a);
    const bInf = isInfluentialCite(b);
    if (aInf !== bInf) {
      return aInf ? -1 : 1;
    }
    const aYear = a.publicationYear ?? 9999;
    const bYear = b.publicationYear ?? 9999;
    return aYear - bYear;
  });
}

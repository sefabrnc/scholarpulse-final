"use client";

import { InfluentialBadge } from "./InfluentialBadge";
import { usePaperBadge, type PaperBadgeData } from "../../hooks/usePaperBadge";

type PaperBadgeInlineProps = {
  doi: string;
  badge?: PaperBadgeData | null;
};

export function PaperBadgeInline(props: PaperBadgeInlineProps) {
  const fetched = usePaperBadge(props.badge ? null : props.doi);
  const data = props.badge ?? fetched.data;
  const loading = props.badge ? false : fetched.loading;
  if (loading || !data || data.influential_count <= 0) {
    return null;
  }
  return <InfluentialBadge count={data.influential_count} compact />;
}

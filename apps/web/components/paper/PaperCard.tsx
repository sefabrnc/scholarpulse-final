"use client";

import Link from "next/link";
import { InfluentialBadge } from "./InfluentialBadge";
import { usePaperBadge, type PaperBadgeData } from "../../hooks/usePaperBadge";

type PaperCardProps = {
  doi: string;
  title?: string;
  subtitle?: string;
  meta?: string;
  showBadge?: boolean;
  badge?: PaperBadgeData | null;
  href?: string;
};

export function PaperCard(props: PaperCardProps) {
  const shouldFetchBadge = props.showBadge && !props.badge;
  const { data: fetchedBadge, loading: badgeLoading } = usePaperBadge(
    shouldFetchBadge ? props.doi : null
  );
  const badge = props.badge ?? fetchedBadge;
  const title = props.title ?? badge?.title ?? props.doi;
  const href = props.href ?? `/paper/${encodeURIComponent(props.doi)}`;

  return (
    <article className="paper-card">
      <div className="paper-card-header">
        <strong className="paper-card-title">{title}</strong>
        {props.showBadge && badge ? (
          <InfluentialBadge count={badge.influential_count} compact />
        ) : null}
        {props.showBadge && shouldFetchBadge && badgeLoading ? (
          <span className="muted-small">badge...</span>
        ) : null}
      </div>
      {props.subtitle ? <p className="muted-small">{props.subtitle}</p> : null}
      {props.meta ? <p className="muted-small">{props.meta}</p> : null}
      {props.showBadge && badge ? (
        <p className="muted-small">
          {badge.citation_count} citations · {badge.supports} supports · {badge.contradicts} contradicts
        </p>
      ) : null}
      <Link href={href} className="paper-card-link">
        Open paper
      </Link>
    </article>
  );
}

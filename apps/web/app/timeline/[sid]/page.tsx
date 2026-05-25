"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, PublicScaffold } from "../../../components/public/PublicScaffold";

type TimelineItem = {
  relation: "references" | "cited_by";
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedByCount: number;
  url: string;
  authors: string[];
};

type TimelinePayload = {
  root?: TimelineItem | null;
  events?: TimelineItem[];
  error?: string;
};

export default function PublicTimelinePage() {
  const params = useParams();
  const sidParam = params?.sid;
  const sid = useMemo(() => decodeURIComponent(Array.isArray(sidParam) ? sidParam[0] : sidParam || ""), [sidParam]);
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<TimelinePayload | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      const response = await fetch(`/api/public/timeline/${encodeURIComponent(sid)}`);
      const json = (await response.json()) as TimelinePayload;
      if (!active) {
        return;
      }
      setPayload(json);
      setLoading(false);
    }
    run().catch(() => {
      if (!active) {
        return;
      }
      setPayload({ error: "Timeline could not be loaded." });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [sid]);

  const events = payload?.events ?? [];

  return (
    <PublicScaffold title="Timeline" subtitle="Public citation timeline snapshot from available metadata.">
      {loading ? <LoadingState /> : null}
      {!loading && payload?.error ? <EmptyState message={payload.error} /> : null}

      {!loading && payload?.root ? (
        <section className="public-card">
          <p className="public-section-label">Root item</p>
          <h2 className="public-card-title">{payload.root.title}</h2>
          <p className="public-muted">{payload.root.authors.join(", ") || "Unknown authors"}</p>
        </section>
      ) : null}

      {!loading && events.length === 0 ? <EmptyState message="No timeline events were found for this identifier." /> : null}

      {events.length > 0 ? (
        <ul className="public-list">
          {events.map((event) => (
            <li key={`${event.relation}-${event.id}`} className="public-card">
              <p className="public-section-label">{event.relation === "cited_by" ? "Cited by" : "References"}</p>
              <h3 className="public-card-title">{event.title}</h3>
              <p className="public-muted">{(event.authors || []).slice(0, 5).join(", ") || "Unknown authors"}</p>
              <p className="public-muted">
                {event.year ?? "Unknown year"} · {event.citedByCount} citations
              </p>
              <div className="public-links">
                {event.doi ? (
                  <Link href={`/paper/${encodeURIComponent(event.doi)}`} className="public-link">
                    Open paper
                  </Link>
                ) : null}
                <Link href={`/cite/${encodeURIComponent(event.id)}`} className="public-link">
                  Cite preview
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </PublicScaffold>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, PublicScaffold } from "../../../components/public/PublicScaffold";

type TopicTimelinePoint = {
  year: number;
  paperCount: number;
  citationTotal: number;
};

type TopicPaper = {
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedByCount: number;
  url: string;
  authors: string[];
};

type TopicPayload = {
  source?: "worker" | "openalex";
  topic?: string;
  timeline?: TopicTimelinePoint[];
  papers?: TopicPaper[];
  error?: string;
};

export default function PublicTopicPage() {
  const params = useParams();
  const nameParam = params?.name;
  const topicName = useMemo(
    () => decodeURIComponent(Array.isArray(nameParam) ? nameParam[0] : nameParam || ""),
    [nameParam]
  );
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<TopicPayload | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      const response = await fetch(`/api/public/topics/${encodeURIComponent(topicName)}`);
      const json = (await response.json()) as TopicPayload;
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
      setPayload({ error: "Topic data could not be loaded." });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [topicName]);

  const timeline = payload?.timeline ?? [];
  const papers = payload?.papers ?? [];

  return (
    <PublicScaffold title="Topic" subtitle="Public read-only topic evolution and representative papers.">
      {!loading && payload?.source ? (
        <p className="public-muted">Data source: {payload.source === "worker" ? "ScholarPulse index" : "OpenAlex fallback"}</p>
      ) : null}
      {loading ? <LoadingState /> : null}
      {!loading && payload?.error ? <EmptyState message={payload.error} /> : null}

      {!loading && timeline.length > 0 ? (
        <section className="public-card">
          <h2 className="public-section-label">Timeline</h2>
          <ul className="public-timeline-list">
            {timeline.map((point) => (
              <li key={point.year} className="public-timeline-row">
                <span>{point.year}</span>
                <span className="public-muted">
                  {point.paperCount} papers · {point.citationTotal} citations
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!loading && papers.length === 0 ? <EmptyState message="No papers were found for this topic query." /> : null}

      {papers.length > 0 ? (
        <ul className="public-list">
          {papers.slice(0, 12).map((paper) => (
            <li key={paper.id} className="public-card">
              <h3 className="public-card-title">{paper.title}</h3>
              <p className="public-muted">
                {paper.year ?? "Unknown year"} · {paper.citedByCount} citations
              </p>
              {paper.doi ? (
                <Link href={`/paper/${encodeURIComponent(paper.doi)}`} className="public-link">
                  Open paper
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </PublicScaffold>
  );
}

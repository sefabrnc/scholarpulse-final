"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, PublicScaffold, SourceBadge } from "../../../components/public/PublicScaffold";

type Paper = {
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedByCount: number;
  url: string;
  authors: string[];
};

type AuthorPayload = {
  source?: "worker" | "openalex" | "openalex_fallback";
  workerUnavailable?: boolean;
  profile?: {
    id: string;
    name: string;
    worksCount: number;
    citedByCount: number;
    hIndex: number;
  };
  papers?: Paper[];
  error?: string;
};

export default function PublicAuthorPage() {
  const params = useParams();
  const nameParam = params?.name;
  const name = useMemo(
    () => decodeURIComponent(Array.isArray(nameParam) ? nameParam[0] : nameParam || ""),
    [nameParam]
  );
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<AuthorPayload | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      const response = await fetch(`/api/public/authors/${encodeURIComponent(name)}`);
      const json = (await response.json()) as AuthorPayload;
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
      setPayload({ error: "Author profile could not be loaded." });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [name]);

  const papers = payload?.papers ?? [];

  return (
    <PublicScaffold title="Author" subtitle="Public read-only author snapshot and top papers.">
      {!loading && payload?.source ? (
        <SourceBadge source={payload.source} workerUnavailable={payload.workerUnavailable} />
      ) : null}
      {loading ? <LoadingState /> : null}
      {!loading && payload?.error ? <EmptyState message={payload.error} /> : null}

      {!loading && payload?.profile ? (
        <section className="public-card">
          <h2 className="public-card-title">{payload.profile.name}</h2>
          <p className="public-muted">
            {payload.profile.worksCount} works · {payload.profile.citedByCount} citations · h-index{" "}
            {payload.profile.hIndex}
          </p>
        </section>
      ) : null}

      {!loading && papers.length === 0 ? <EmptyState message="No public papers were found for this author query." /> : null}

      {papers.length > 0 ? (
        <ul className="public-list">
          {papers.map((paper) => (
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

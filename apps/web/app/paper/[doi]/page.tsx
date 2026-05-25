"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { PaperBadgeInline } from "../../../components/paper/PaperBadgeInline";
import { EmptyState, LoadingState, PublicScaffold } from "../../../components/public/PublicScaffold";

type PaperPayload = {
  title?: string;
  authors?: string[];
  abstract?: string | null;
  published_at?: string | null;
  journal?: string | null;
  url?: string;
  doi?: string;
  error?: string;
};

export default function PublicPaperPage() {
  const params = useParams();
  const doiParam = params?.doi;
  const decodedDoi = useMemo(
    () => decodeURIComponent(Array.isArray(doiParam) ? doiParam[0] : doiParam || ""),
    [doiParam]
  );
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PaperPayload | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      const response = await fetch(`/api/public/paper?doi=${encodeURIComponent(decodedDoi)}`);
      const payload = (await response.json()) as PaperPayload;
      if (!active) {
        return;
      }
      setData(payload);
      setLoading(false);
    }

    run().catch(() => {
      if (!active) {
        return;
      }
      setData({ error: "Paper metadata could not be loaded." });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [decodedDoi]);

  const jsonLd = data?.title
    ? {
        "@context": "https://schema.org",
        "@type": "ScholarlyArticle",
        name: data.title,
        identifier: data.doi ?? decodedDoi,
        author: (data.authors ?? []).map((name) => ({ "@type": "Person", name }))
      }
    : null;

  return (
    <PublicScaffold title="Paper" subtitle={`Public read-only view for DOI ${decodedDoi}.`}>
      {jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      ) : null}
      {loading ? <LoadingState /> : null}
      {!loading && data?.error ? <EmptyState message={data.error} /> : null}
      {!loading && data && !data.error ? (
        <article className="public-card">
          <h2 className="public-card-title">{data.title || "Untitled paper"}</h2>
          <p className="public-muted">{(data.authors ?? []).join(", ") || "Unknown authors"}</p>
          <p className="public-muted">
            {data.published_at || "Unknown date"} · {data.journal || "Unknown venue"}
          </p>
          <PaperBadgeInline doi={data.doi || decodedDoi} />
          <p className="public-body">
            {data.abstract || "No abstract was returned by public metadata providers."}
          </p>
          <div className="public-links">
            {data.url ? (
              <a href={data.url} target="_blank" rel="noreferrer" className="public-link">
                Open publisher page
              </a>
            ) : null}
            <Link href={`/timeline/${encodeURIComponent(data.doi || decodedDoi)}`} className="public-link">
              Open timeline preview
            </Link>
          </div>
        </article>
      ) : null}
    </PublicScaffold>
  );
}

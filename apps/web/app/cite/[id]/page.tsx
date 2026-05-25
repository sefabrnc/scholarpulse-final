"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, LoadingState, PublicScaffold } from "../../../components/public/PublicScaffold";

type WorkCard = {
  id: string;
  doi: string | null;
  title: string;
  year: number | null;
  citedByCount: number;
  url: string;
  authors: string[];
};

type CitePayload = {
  source?: WorkCard | null;
  target?: WorkCard | null;
  error?: string;
};

function WorkSection({ title, work }: { title: string; work: WorkCard | null | undefined }) {
  if (!work) {
    return <EmptyState message={`${title} is unavailable for this identifier.`} />;
  }
  return (
    <section className="public-card">
      <p className="public-section-label">{title}</p>
      <h2 className="public-card-title">{work.title}</h2>
      <p className="public-muted">{work.authors.join(", ") || "Unknown authors"}</p>
      <p className="public-muted">
        {work.year ?? "Unknown year"} · {work.citedByCount} citations
      </p>
      <div className="public-links">
        {work.doi ? (
          <Link href={`/paper/${encodeURIComponent(work.doi)}`} className="public-link">
            Open paper
          </Link>
        ) : null}
        <Link href={`/timeline/${encodeURIComponent(work.id)}`} className="public-link">
          Timeline
        </Link>
      </div>
    </section>
  );
}

export default function PublicCitePage() {
  const params = useParams();
  const idParam = params?.id;
  const id = useMemo(() => decodeURIComponent(Array.isArray(idParam) ? idParam[0] : idParam || ""), [idParam]);
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<CitePayload | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      const response = await fetch(`/api/public/cite/${encodeURIComponent(id)}`);
      const json = (await response.json()) as CitePayload;
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
      setPayload({ error: "Citation preview could not be loaded." });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <PublicScaffold title="Citation Preview" subtitle="Public read-only citation pair preview.">
      {loading ? <LoadingState /> : null}
      {!loading && payload?.error ? <EmptyState message={payload.error} /> : null}

      {!loading && !payload?.error ? (
        <div className="public-grid-two">
          <WorkSection title="Source" work={payload?.source} />
          <WorkSection title="Target" work={payload?.target} />
        </div>
      ) : null}
    </PublicScaffold>
  );
}

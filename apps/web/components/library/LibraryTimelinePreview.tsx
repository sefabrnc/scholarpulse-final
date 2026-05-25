"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getUserId } from "../../lib/api/client";
import type { TimelineItem, TimelineResponse } from "../../types/citation";

type LibraryPaper = {
  node_id: string;
  doi: string | null;
  title: string;
  year: number | null;
};

const MAX_SEEDS = 5;

type LibraryTimelinePreviewProps = {
  onError?: (message: string | null) => void;
};

export function LibraryTimelinePreview(props: LibraryTimelinePreviewProps) {
  const [papers, setPapers] = useState<LibraryPaper[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingLibrary(true);
      props.onError?.(null);
      try {
        const response = await fetch("/api/export/library?format=json", {
          headers: {
            accept: "application/json",
            "x-user-id": getUserId()
          },
          cache: "no-store"
        });
        if (!response.ok) {
          throw new Error(`Library export failed (${response.status})`);
        }
        const payload = (await response.json()) as LibraryPaper[];
        if (!alive) {
          return;
        }
        const items = Array.isArray(payload) ? payload : [];
        setPapers(items);
        const defaults: Record<string, boolean> = {};
        for (const paper of items.slice(0, Math.min(3, MAX_SEEDS))) {
          defaults[paper.node_id] = true;
        }
        setSelected(defaults);
      } catch (cause) {
        if (alive) {
          props.onError?.(cause instanceof Error ? cause.message : "Library load failed");
        }
      } finally {
        if (alive) {
          setLoadingLibrary(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [props]);

  const selectedIds = useMemo(
    () => papers.filter((paper) => selected[paper.node_id]).map((paper) => paper.node_id),
    [papers, selected]
  );

  const toggleSeed = useCallback((nodeId: string) => {
    setSelected((prev) => {
      const next = { ...prev, [nodeId]: !prev[nodeId] };
      const count = Object.values(next).filter(Boolean).length;
      if (count > MAX_SEEDS) {
        return prev;
      }
      return next;
    });
  }, []);

  const loadTimeline = useCallback(async () => {
    if (selectedIds.length === 0) {
      props.onError?.("Select at least one library paper as a timeline seed.");
      return;
    }
    setLoadingTimeline(true);
    props.onError?.(null);
    setTimeline(null);
    try {
      const params = new URLSearchParams({
        ids: selectedIds.join(","),
        plan: "free",
        limit: "20"
      });
      const response = await fetch(`/api/cite/timeline?${params.toString()}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Timeline request failed (${response.status})`);
      }
      const payload = (await response.json()) as TimelineResponse;
      setTimeline(payload);
    } catch (cause) {
      props.onError?.(cause instanceof Error ? cause.message : "Timeline preview failed");
    } finally {
      setLoadingTimeline(false);
    }
  }, [props, selectedIds]);

  const items = timeline?.items ?? [];

  return (
    <section className="section-card column">
      <strong>Multi-seed timeline preview</strong>
      <p className="muted-small">
        Select up to {MAX_SEEDS} saved papers. Merged 1-hop citation cards from{" "}
        <code>/api/cite/timeline</code> (deduped by related paper).
      </p>

      {loadingLibrary ? <p className="muted-small">Loading library seeds...</p> : null}
      {!loadingLibrary && papers.length === 0 ? (
        <p className="muted-small">Save papers to your library to seed a timeline preview.</p>
      ) : null}

      {!loadingLibrary && papers.length > 0 ? (
        <div className="column">
          {papers.map((paper) => (
            <label key={paper.node_id} className="row muted-small" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={Boolean(selected[paper.node_id])}
                onChange={() => toggleSeed(paper.node_id)}
              />
              <span>
                {paper.year ?? "?"} — {paper.title}
                {paper.doi ? ` (${paper.doi})` : ""}
              </span>
            </label>
          ))}
          <button type="button" onClick={loadTimeline} disabled={loadingTimeline || selectedIds.length === 0}>
            {loadingTimeline ? "Loading timeline..." : `Preview timeline (${selectedIds.length} seed${selectedIds.length === 1 ? "" : "s"})`}
          </button>
        </div>
      ) : null}

      {timeline ? (
        <div className="column">
          <p className="muted-small">
            {items.length} merged cards from {timeline.seeds?.length ?? selectedIds.length} seed(s)
            {timeline.perSeed
              ? ` · per-seed counts: ${Object.entries(timeline.perSeed)
                  .map(([seed, count]) => `${seed.slice(0, 8)}…=${count}`)
                  .join(", ")}`
              : ""}
          </p>
          {items.length === 0 ? (
            <p className="muted-small">No citation neighbors found for selected seeds.</p>
          ) : (
            items.map((item: TimelineItem) => (
              <article
                key={item.edgeId}
                className={`timeline-card${item.isInfluential ? " timeline-card-influential" : ""}`}
              >
                <div style={{ fontWeight: 600 }}>
                  {item.publicationYear ?? "n/a"} — {item.title}
                </div>
                <div className="muted-small">
                  {item.venue ?? "Unknown venue"} · {item.direction}
                  {item.isInfluential ? " · influential" : ""}
                  {item.doiNorm ? ` · ${item.doiNorm}` : ""}
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

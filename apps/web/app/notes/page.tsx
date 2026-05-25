"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../../lib/api/client";

type Annotation = {
  id: string;
  doi: string;
  page: number;
  note?: string;
  color?: string;
};

type AnnotationResponse = {
  items: Annotation[];
};

export default function NotesPage() {
  const [doi, setDoi] = useState("10.5555/sample-source");
  const [noteText, setNoteText] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (nextDoi: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<AnnotationResponse>(`/api/annotations?doi=${encodeURIComponent(nextDoi)}`);
      setAnnotations(response.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Annotation request failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(doi).catch(() => {
      // load() already sets error state
    });
  }, [doi]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await apiPost("/api/annotations", {
        doi,
        page: 1,
        norm_x: 0.2,
        norm_y: 0.2,
        norm_w: 0.3,
        norm_h: 0.05,
        color: "yellow",
        note: noteText
      });
      setNoteText("");
      await load(doi);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Annotation create failed");
    }
  };

  const handleDelete = async (annotationId: string) => {
    setBusyId(annotationId);
    setError(null);
    try {
      await apiDelete(`/api/annotations/${encodeURIComponent(annotationId)}`);
      await load(doi);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Annotation delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Notes</h1>
        <p className="muted-small">
          Backend links: <code>GET/POST /api/annotations</code>, <code>DELETE /api/annotations/:id</code>.
        </p>
      </header>

      <section className="section-card column">
        <strong>Create annotation</strong>
        <form onSubmit={handleCreate} className="column">
          <input value={doi} onChange={(event) => setDoi(event.target.value)} placeholder="DOI" />
          <textarea
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="Short note"
            rows={3}
          />
          <button type="submit">Save annotation</button>
        </form>
      </section>

      <section className="section-card column">
        <strong>Saved annotations</strong>
        {loading ? <p className="muted-small">Loading...</p> : null}
        {!loading && annotations.length === 0 ? <p className="muted-small">No annotations yet.</p> : null}
        {annotations.map((annotation) => (
          <article key={annotation.id} className="section-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <p style={{ margin: 0 }}>
                <strong>{annotation.doi}</strong> page {annotation.page}
              </p>
              <button type="button" onClick={() => handleDelete(annotation.id)} disabled={busyId === annotation.id}>
                {busyId === annotation.id ? "Deleting..." : "Delete"}
              </button>
            </div>
            <p className="muted-small">{annotation.note ?? "No note text"}</p>
          </article>
        ))}
      </section>

      {error ? <p className="muted-small">Error: {error}</p> : null}
    </main>
  );
}

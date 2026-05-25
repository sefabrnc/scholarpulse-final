"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import { CollectionTree } from "../../components/library/CollectionTree";
import { ContinueReading } from "../../components/library/ContinueReading";
import { ExportLibraryModal } from "../../components/library/ExportLibraryModal";
import { LibraryTimelinePreview } from "../../components/library/LibraryTimelinePreview";
import { apiGet, apiPost, getUserId } from "../../lib/api/client";

type ResolveResult = {
  status?: string;
  canonical_doi?: string;
  doi?: string;
  normalized?: string;
  title?: string;
  tldr?: string | null;
  redirect?: { href?: string; path?: string };
  pending_id?: string;
};

type ImportResult = {
  imported_count?: number;
  queued_count?: number;
  detected_dois?: number;
};

type UploadResult = {
  upload_id?: string;
  status?: string;
  byte_size?: number;
  poll?: { href?: string };
};

export default function LibraryPage() {
  const [resolveInput, setResolveInput] = useState("");
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [importContent, setImportContent] = useState("");
  const [importFormat, setImportFormat] = useState<"auto" | "bibtex" | "ris">("auto");
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const handleResolve = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResolveResult(null);
    try {
      const response = await apiGet<ResolveResult>(`/api/resolve?id=${encodeURIComponent(resolveInput)}`);
      setResolveResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Resolve request failed");
    }
  };

  const handleImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setImportResult(null);
    setBusy("import");
    try {
      const response = await apiPost<ImportResult>("/api/library/import", {
        format: importFormat,
        content: importContent
      });
      setImportResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import request failed");
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    setImportResult(null);
    setBusy("import-file");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("format", importFormat);
      const response = await fetch("/api/library/import", {
        method: "POST",
        headers: {
          "x-user-id": getUserId()
        },
        body: formData
      });
      const payload = (await response.json()) as ImportResult & { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Import file upload failed");
      }
      setImportResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import file upload failed");
    } finally {
      setBusy(null);
      event.target.value = "";
    }
  };

  const handlePdfUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError("PDF must be 50 MB or smaller");
      event.target.value = "";
      return;
    }
    setError(null);
    setUploadResult(null);
    setBusy("upload");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/papers/upload", {
        method: "POST",
        headers: {
          "x-user-id": getUserId()
        },
        body: formData
      });
      const payload = (await response.json()) as UploadResult & { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "PDF upload failed");
      }
      setUploadResult(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF upload failed");
    } finally {
      setBusy(null);
      event.target.value = "";
    }
  };

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Library</h1>
        <p className="muted-small">
          Collections, export, import, and continue-reading are wired to Worker APIs.
        </p>
      </header>

      <section className="section-card column">
        <strong>Continue where you left off</strong>
        <ContinueReading limit={5} />
      </section>

      <LibraryTimelinePreview onError={setError} />

      <section className="section-card column">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Collections</strong>
          <button type="button" onClick={() => setExportOpen(true)}>
            Export library
          </button>
        </div>
        <CollectionTree onError={setError} />
      </section>

      <section className="section-card column">
        <strong>Import bibliography</strong>
        <div className="row">
          <label className="muted-small">
            Format
            <select
              value={importFormat}
              onChange={(event) => setImportFormat(event.target.value as "auto" | "bibtex" | "ris")}
              style={{ marginLeft: 8 }}
            >
              <option value="auto">auto</option>
              <option value="bibtex">BibTeX</option>
              <option value="ris">RIS</option>
            </select>
          </label>
          <label className="muted-small">
            File
            <input type="file" accept=".bib,.bibtex,.ris,.txt" onChange={handleImportFile} style={{ marginLeft: 8 }} />
          </label>
        </div>
        <form onSubmit={handleImport} className="column">
          <textarea
            value={importContent}
            onChange={(event) => setImportContent(event.target.value)}
            placeholder="Paste BibTeX or RIS entries"
            rows={6}
            style={{ width: "100%" }}
          />
          <button type="submit" disabled={busy === "import"}>
            {busy === "import" ? "Importing..." : "Import pasted content"}
          </button>
        </form>
        {importResult ? (
          <p className="muted-small">
            Imported {importResult.imported_count ?? 0}, queued {importResult.queued_count ?? 0} (
            {importResult.detected_dois ?? 0} DOIs detected).
          </p>
        ) : null}
      </section>

      <section className="section-card column">
        <strong>Upload PDF</strong>
        <p className="muted-small">Max 50 MB. Queues Colab ingest when API upstream is configured.</p>
        <input type="file" accept="application/pdf,.pdf" onChange={handlePdfUpload} disabled={busy === "upload"} />
        {uploadResult ? (
          <p className="muted-small">
            Upload {uploadResult.upload_id} status {uploadResult.status} ({uploadResult.byte_size ?? 0} bytes).
          </p>
        ) : null}
      </section>

      <section className="section-card column">
        <strong>Quick resolve</strong>
        <form onSubmit={handleResolve} className="row">
          <input
            value={resolveInput}
            onChange={(event) => setResolveInput(event.target.value)}
            placeholder="doi:10.xxxx or arxiv:2401.12345"
            style={{ flex: 1 }}
          />
          <button type="submit">Resolve</button>
        </form>
        {resolveResult ? (
          <div className="column">
            <p className="muted-small">
              {resolveResult.status ?? "ok"}:{" "}
              {resolveResult.canonical_doi ?? resolveResult.doi ?? resolveResult.normalized ?? "Resolve succeeded."}
            </p>
            {resolveResult.title ? <p className="muted-small">{resolveResult.title}</p> : null}
            {resolveResult.tldr ? <p className="muted-small">{resolveResult.tldr}</p> : null}
            {resolveResult.redirect?.href ? (
              <a href={resolveResult.redirect.href}>Open paper page</a>
            ) : null}
            {resolveResult.pending_id ? (
              <p className="muted-small">Pending ingest id: {resolveResult.pending_id}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <ExportLibraryModal open={exportOpen} onClose={() => setExportOpen(false)} onError={setError} />
      {error ? <p className="muted-small">Error: {error}</p> : null}
    </main>
  );
}

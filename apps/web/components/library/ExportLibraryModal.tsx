"use client";

import { useState } from "react";
import { getUserId } from "../../lib/api/client";

type ExportFormat = "bibtex" | "ris" | "json";

type ExportLibraryModalProps = {
  open: boolean;
  onClose: () => void;
  onError?: (message: string | null) => void;
};

export function ExportLibraryModal(props: ExportLibraryModalProps) {
  const [format, setFormat] = useState<ExportFormat>("bibtex");
  const [busy, setBusy] = useState(false);

  if (!props.open) {
    return null;
  }

  const handleDownload = async () => {
    setBusy(true);
    props.onError?.(null);
    try {
      const response = await fetch(
        `/api/export/library?format=${encodeURIComponent(format)}`,
        {
          method: "GET",
          headers: {
            Accept: "*/*",
            "x-user-id": getUserId()
          },
          cache: "no-store"
        }
      );
      if (!response.ok) {
        const text = await response.text();
        let message = "Export failed";
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } };
          message = parsed.error?.message ?? message;
        } catch {
          message = text || message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const extension = format === "bibtex" ? "bib" : format;
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `library.${extension}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      props.onClose();
    } catch (cause) {
      props.onError?.(cause instanceof Error ? cause.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="modal-panel column"
        role="dialog"
        aria-label="Export library"
        onClick={(event) => event.stopPropagation()}
      >
        <strong>Export library</strong>
        <p className="muted-small">Download your saved papers as BibTeX, RIS, or JSON.</p>
        <label className="column">
          <span className="muted-small">Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
            <option value="bibtex">BibTeX (.bib)</option>
            <option value="ris">RIS (.ris)</option>
            <option value="json">JSON (.json)</option>
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" onClick={handleDownload} disabled={busy}>
            {busy ? "Preparing..." : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}

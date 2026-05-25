"use client";

import { FormEvent, useEffect, useState } from "react";
import type { AnnotationItem } from "../../hooks/useAnnotations";

const COLOR_MAP: Record<string, string> = {
  yellow: "rgba(250, 204, 21, 0.35)",
  red: "rgba(248, 113, 113, 0.35)",
  blue: "rgba(96, 165, 250, 0.35)",
  green: "rgba(74, 222, 128, 0.35)"
};

type AnnotationOverlayLayerProps = {
  annotations: AnnotationItem[];
  onSelect?: (annotation: AnnotationItem) => void;
  onCreateAt?: (point: { x: number; y: number }) => void;
  creating?: boolean;
};

export function AnnotationOverlayLayer(props: AnnotationOverlayLayerProps) {
  return (
    <div className="annotation-overlay-layer">
      {props.annotations.map((annotation) => (
        <button
          key={annotation.id}
          type="button"
          className="annotation-highlight"
          title={annotation.note ?? "Annotation"}
          aria-label={annotation.note ?? "Annotation highlight"}
          style={{
            left: `${annotation.norm_x * 100}%`,
            top: `${annotation.norm_y * 100}%`,
            width: `${annotation.norm_w * 100}%`,
            height: `${annotation.norm_h * 100}%`,
            background: COLOR_MAP[annotation.color ?? "yellow"] ?? COLOR_MAP.yellow
          }}
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect?.(annotation);
          }}
        />
      ))}
      {props.creating ? (
        <div
          className="annotation-create-hint"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width;
            const y = (event.clientY - rect.top) / rect.height;
            props.onCreateAt?.({ x, y });
          }}
        />
      ) : null}
    </div>
  );
}

type AnnotationNotePopupProps = {
  annotation: AnnotationItem | null;
  onClose: () => void;
  onSave: (id: string, note: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function AnnotationNotePopup(props: AnnotationNotePopupProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNote(props.annotation?.note ?? "");
  }, [props.annotation]);

  if (!props.annotation) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      await props.onSave(props.annotation!.id, note);
      props.onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="annotation-note-popup" role="dialog" aria-label="Annotation note">
      <form onSubmit={handleSubmit} className="column">
        <strong>Page {props.annotation.page} note</strong>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          placeholder="Private note"
        />
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              props
                .onDelete(props.annotation!.id)
                .then(() => props.onClose())
                .finally(() => setBusy(false));
            }}
            disabled={busy}
          >
            Delete
          </button>
          <button type="button" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

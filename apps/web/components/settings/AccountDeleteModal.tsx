"use client";

type AccountDeleteModalProps = {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AccountDeleteModal(props: AccountDeleteModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onCancel}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="account-delete-title" style={{ marginTop: 0 }}>
          Delete account data?
        </h2>
        <p className="muted-small">
          This sends <code>DELETE /api/user/me</code> and removes library, annotations, sessions,
          collections, saved searches, and notifications for this user scope.
        </p>
        <p className="muted-small">This action cannot be undone.</p>
        <div className="modal-actions">
          <button type="button" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button type="button" className="danger-button" onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? "Deleting..." : "Yes, delete my data"}
          </button>
        </div>
      </div>
    </div>
  );
}

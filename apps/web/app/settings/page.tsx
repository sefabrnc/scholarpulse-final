"use client";

import { FormEvent, useState } from "react";
import { AccountDeleteModal } from "../../components/settings/AccountDeleteModal";
import { apiDelete } from "../../lib/api/client";
import { loadSettings, saveSettings, type ThemeMode, type UserSettings } from "../../lib/userScope";

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings>(loadSettings());
  const [savedMessage, setSavedMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveSettings(settings);
    setSavedMessage("Settings saved locally and theme applied.");
  };

  const handleDeleteAccount = async () => {
    setDeleteBusy(true);
    setDeleteMessage("");
    try {
      await apiDelete<{ ok?: boolean }>("/api/user/me");
      setDeleteMessage("Account data delete request completed.");
      setDeleteModalOpen(false);
    } catch (cause) {
      setDeleteMessage(cause instanceof Error ? cause.message : "Account delete failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Settings</h1>
        <p className="muted-small">
          Theme and digest preferences are local. Account delete uses <code>/api/user/me</code> when upstream is configured.
        </p>
      </header>
      <section className="section-card column">
        <form onSubmit={handleSubmit} className="column">
          <label className="row">
            <input
              type="checkbox"
              checked={settings.digestEnabled}
              onChange={(event) => setSettings({ ...settings, digestEnabled: event.target.checked })}
            />
            <span>Digest notifications enabled</span>
          </label>
          <label className="column">
            <span>Theme mode</span>
            <select
              value={settings.themeMode}
              onChange={(event) => setSettings({ ...settings, themeMode: event.target.value as ThemeMode })}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.compactCards}
              onChange={(event) => setSettings({ ...settings, compactCards: event.target.checked })}
            />
            <span>Compact cards</span>
          </label>
          <button type="submit">Save settings</button>
        </form>
        {savedMessage ? <p className="muted-small">{savedMessage}</p> : null}
      </section>

      <section className="section-card column">
        <strong>Account</strong>
        <p className="muted-small">GDPR cascade delete via Worker API when SCHOLARPULSE_API_BASE_URL is set.</p>
        <button type="button" onClick={() => setDeleteModalOpen(true)} disabled={deleteBusy}>
          Delete account data
        </button>
        {deleteMessage ? <p className="muted-small">{deleteMessage}</p> : null}
      </section>

      <AccountDeleteModal
        open={deleteModalOpen}
        busy={deleteBusy}
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={() => {
          handleDeleteAccount().catch(() => {
            // handleDeleteAccount sets deleteMessage on failure
          });
        }}
      />
    </main>
  );
}

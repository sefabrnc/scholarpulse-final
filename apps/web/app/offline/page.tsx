import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="offline-shell">
      <section className="offline-card">
        <h1>You are offline</h1>
        <p className="public-muted">Public pages you already visited stay available. Reconnect to refresh live metadata.</p>
        <Link href="/search" className="public-button">
          Open search
        </Link>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api/client";

type Channel = {
  id: string;
  name: string;
  scope?: "internal" | "public";
  description?: string;
};

type ChannelsResponse = {
  channels: Channel[];
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"all" | "internal" | "public">("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      setError(null);
      try {
        const response = await apiGet<ChannelsResponse>("/api/channels");
        if (alive) {
          setChannels(response.channels ?? []);
        }
      } catch (cause) {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "Channels request failed");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (scopeFilter === "all") {
      return channels;
    }
    return channels.filter((channel) => (channel.scope ?? "internal") === scopeFilter);
  }, [channels, scopeFilter]);

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>Channels</h1>
        <p className="muted-small">Internal/public channel list with scope filter and detail feed preview.</p>
      </header>
      <section className="section-card row">
        <label className="muted-small">
          Scope
          <select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value as typeof scopeFilter)} style={{ marginLeft: 8 }}>
            <option value="all">all</option>
            <option value="internal">internal</option>
            <option value="public">public</option>
          </select>
        </label>
      </section>
      {error ? <p className="muted-small">Error: {error}</p> : null}
      <section className="section-card column">
        {filtered.length === 0 ? <p className="muted-small">No channels available for this filter.</p> : null}
        {filtered.map((channel) => (
          <article key={channel.id} className="section-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{channel.name}</strong>
              <span className="muted-small">{channel.scope ?? "internal"}</span>
            </div>
            <p className="muted-small">{channel.description ?? "No description"}</p>
            <Link href={`/channels/${encodeURIComponent(channel.id)}`}>Open channel</Link>
          </article>
        ))}
      </section>
    </main>
  );
}

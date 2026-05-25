"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../../lib/api/client";

type ChannelFeedItem = {
  doi: string;
  reason?: string;
  score?: number;
  title?: string;
};

type ChannelDetails = {
  id: string;
  name: string;
  scope?: string;
  description?: string;
};

export default function ChannelDetailPage() {
  const params = useParams();
  const idParam = params?.id;
  const channelId = Array.isArray(idParam) ? idParam[0] : idParam;

  const [details, setDetails] = useState<ChannelDetails | null>(null);
  const [items, setItems] = useState<ChannelFeedItem[]>([]);
  const [recommendations, setRecommendations] = useState<ChannelFeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId) {
      return;
    }
    let alive = true;
    (async () => {
      setError(null);
      try {
        const [channels, feed, recommend] = await Promise.all([
          apiGet<{ channels: ChannelDetails[] }>("/api/channels"),
          apiGet<{ items: ChannelFeedItem[] }>("/api/feed"),
          apiGet<{ items: ChannelFeedItem[] }>("/api/recommend")
        ]);
        if (!alive) {
          return;
        }
        const found = (channels.channels ?? []).find((channel) => channel.id === channelId) ?? null;
        setDetails(found);
        setItems(feed.items ?? []);
        setRecommendations(recommend.items ?? []);
      } catch (cause) {
        if (alive) {
          setError(cause instanceof Error ? cause.message : "Channel detail request failed");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [channelId]);

  const mergedItems = useMemo(() => {
    const combined = [...items, ...recommendations];
    if (details?.scope === "public") {
      return combined.filter((item) => item.reason !== "topic_match");
    }
    return combined;
  }, [details?.scope, items, recommendations]);

  return (
    <main className="page-shell column">
      <header>
        <h1 style={{ margin: "0 0 6px" }}>{details?.name ?? "Channel"}</h1>
        <p className="muted-small">Channel id: {channelId}</p>
      </header>
      {error ? <p className="muted-small">Error: {error}</p> : null}
      <section className="section-card column">
        <strong>Overview</strong>
        <p className="muted-small">Scope: {details?.scope ?? "internal"}</p>
        <p className="muted-small">{details?.description ?? "No channel description."}</p>
        <Link href="/library" className="public-link">
          Open library
        </Link>
      </section>
      <section className="section-card column">
        <strong>Channel feed preview</strong>
        {mergedItems.length === 0 ? <p className="muted-small">No feed items for this channel yet.</p> : null}
        {mergedItems.slice(0, 8).map((item) => (
          <article key={`${item.doi}-${item.reason ?? "none"}`} className="section-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{item.title ?? item.doi}</strong>
              <span className="muted-small">{item.score?.toFixed(2) ?? "n/a"}</span>
            </div>
            <p className="muted-small">reason {item.reason ?? "unknown"}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

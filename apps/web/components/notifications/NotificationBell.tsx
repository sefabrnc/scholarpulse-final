"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPatch } from "../../lib/api/client";

type NotificationRow = {
  id: string;
  type: string;
  payload_json?: string;
  read_at?: string | null;
  created_at?: number;
};

type NotificationsResponse = {
  ok?: boolean;
  items?: NotificationRow[];
  unread_count?: number;
};

function parsePayloadText(payloadJson: string | undefined): string {
  if (!payloadJson) {
    return "New activity";
  }
  try {
    const parsed = JSON.parse(payloadJson) as { message?: string; query?: string };
    return parsed.message ?? parsed.query ?? "New activity";
  } catch {
    return payloadJson.slice(0, 80);
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = async () => {
    try {
      const response = await apiGet<NotificationsResponse>("/api/notifications?limit=8");
      setItems(response.items ?? []);
      setUnreadCount(response.unread_count ?? 0);
    } catch {
      setItems([]);
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    loadNotifications().catch(() => {
      // loadNotifications clears state on failure
    });
  }, []);

  const markRead = async (id: string) => {
    try {
      await apiPatch(`/api/notifications/${encodeURIComponent(id)}/read`, {});
      await loadNotifications();
    } catch {
      // no-op
    }
  };

  return (
    <div className="notification-bell">
      <button type="button" className="notification-bell-btn" onClick={() => setOpen((value) => !value)}>
        Bell
        {unreadCount > 0 ? <span className="notification-count">{unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="notification-panel">
          <div className="notification-panel-head">
            <strong>Notifications</strong>
            <Link href="/watch" className="public-link-muted" onClick={() => setOpen(false)}>
              Watch
            </Link>
          </div>
          {items.length === 0 ? <p className="muted-small">No notifications yet.</p> : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`notification-row${item.read_at ? "" : " unread"}`}
              onClick={() => {
                markRead(item.id).catch(() => {
                  // markRead is best-effort
                });
              }}
            >
              <span>{parsePayloadText(item.payload_json)}</span>
              <span className="muted-small">{item.type}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

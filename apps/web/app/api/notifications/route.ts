import { NextRequest, NextResponse } from "next/server";
import { tryProxyJson, userIdFromRequest } from "../_lib/upstream";

type NotificationRow = {
  id: string;
  type: string;
  payload_json: string;
  read_at: string | null;
  created_at: number;
};

const localNotifications = new Map<string, NotificationRow[]>();

function seedNotifications(userId: string): NotificationRow[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: "notif_demo_1",
      type: "new_papers_match",
      payload_json: JSON.stringify({ message: "3 new papers matched your saved search: transformers" }),
      read_at: null,
      created_at: now - 3600
    }
  ];
}

function getLocalRows(userId: string): NotificationRow[] {
  if (!localNotifications.has(userId)) {
    localNotifications.set(userId, seedNotifications(userId));
  }
  return localNotifications.get(userId) ?? [];
}

export async function GET(request: NextRequest) {
  const unreadOnly = request.nextUrl.searchParams.get("unread") === "true";
  const proxied = await tryProxyJson<{ items?: NotificationRow[]; unread_count?: number }>(
    request,
    `/api/notifications?${request.nextUrl.searchParams.toString()}`
  );
  if (proxied) {
    return NextResponse.json(proxied);
  }

  const userId = userIdFromRequest(request);
  const rows = getLocalRows(userId);
  const filtered = unreadOnly ? rows.filter((row) => !row.read_at) : rows;
  const unreadCount = rows.filter((row) => !row.read_at).length;
  return NextResponse.json({ ok: true, items: filtered, unread_count: unreadCount, mode: "local_stub" });
}

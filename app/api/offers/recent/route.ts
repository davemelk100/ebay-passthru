import { NextResponse } from "next/server";
import { notificationStore, notificationStoreBackend } from "@/lib/notifications-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns the most recent webhook-delivered notifications. Read-only; safe
// to expose since the data only contains what eBay already pushed to us.
export async function GET() {
  try {
    const events = await notificationStore.recent(100);
    const count = await notificationStore.count();
    return NextResponse.json({
      ok: true,
      backend: notificationStoreBackend,
      count,
      events,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        backend: notificationStoreBackend,
        count: 0,
        events: [],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

"use client";

import { useEffect, useState } from "react";
import { useApiCall } from "./useApiCall";
import type {
  NotificationEvent,
  OffersResult,
  RecentNotificationsResult,
  SubscriptionsResult,
} from "@/lib/types";

function formatExpiration(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = t - Date.now();
  if (diffMs <= 0) return "expired";
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

const RECENT_POLL_MS = 15000;

function formatTimeAgo(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export default function OffersPanel() {
  const { data, error, loading, run } = useApiCall<OffersResult>();
  const [recent, setRecent] = useState<RecentNotificationsResult | null>(null);
  const [subs, setSubs] = useState<SubscriptionsResult | null>(null);

  async function refresh() {
    await run("/api/offers", {});
  }

  // Poll the webhook store every 15s. Reads from in-memory or Upstash
  // depending on what the server has wired up.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/offers/recent", { cache: "no-store" });
        const json = (await r.json()) as RecentNotificationsResult;
        if (!cancelled) setRecent(json);
      } catch {
        // network blip — keep last snapshot
      }
    }
    tick();
    const id = setInterval(tick, RECENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // One-shot fetch of the current Platform Notification subscriptions so
  // we can render the active event types as pills.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/offers/subscriptions", { cache: "no-store" })
      .then((r) => r.json() as Promise<SubscriptionsResult>)
      .then((json) => {
        if (!cancelled) setSubs(json);
      })
      .catch(() => {
        /* keep null */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const offers = data?.offers ?? [];
  const events: NotificationEvent[] = recent?.events ?? [];

  return (
    <details className="group rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="flex cursor-pointer list-none items-center justify-between p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className="text-2xl leading-none text-neutral-500 transition-transform group-open:rotate-90">
            ▸
          </span>
          <h2 className="text-lg font-semibold">Active offers</h2>
        </span>
        <span className="text-xs text-neutral-500">
          {data?.offerCount !== undefined
            ? `${data.offerCount} pending across ${data.itemsWithOffers} item${data.itemsWithOffers === 1 ? "" : "s"}`
            : "GetMyeBaySelling + GetBestOffers"}
        </span>
      </summary>
      <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        {/* Webhook event stream — push-delivered by eBay Platform Notifications. */}
        <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-neutral-700 dark:text-neutral-200">
              Live events{" "}
              <span className="ml-1 font-normal text-neutral-500">
                ({events.length} buffered · {recent?.backend ?? "—"} backend · polls every 15s)
              </span>
            </span>
          </div>
          {subs && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-neutral-500">
                {subs.applicationEnabled === false
                  ? "Webhook delivery is OFF — run "
                  : "Subscribed to: "}
              </span>
              {subs.applicationEnabled === false && (
                <code className="font-mono text-[11px]">
                  node scripts/setup-notifications.mjs
                </code>
              )}
              {(subs.enabledEvents ?? []).map((ev) => (
                <span
                  key={ev}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300"
                  title={`${ev} events POST to ${subs.applicationUrl || "(no URL set)"}`}
                >
                  {ev}
                </span>
              ))}
              {subs.applicationEnabled && (subs.enabledEvents ?? []).length === 0 && (
                <span className="text-[11px] text-amber-600">
                  Application URL is set but no event types are enabled.
                </span>
              )}
            </div>
          )}
          {events.length > 0 ? (
            <ul className="space-y-1.5">
              {events.slice(0, 10).map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-[11px] text-neutral-500">
                    {formatTimeAgo(e.timestamp)}
                  </span>
                  <strong className="text-neutral-700 dark:text-neutral-200">{e.eventName}</strong>
                  {e.offerPrice !== undefined && (
                    <span>
                      {e.offerPrice} {e.currency || ""}
                      {e.quantity ? ` × ${e.quantity}` : ""}
                    </span>
                  )}
                  {e.buyerUserId && <span className="font-mono">from {e.buyerUserId}</span>}
                  {e.title && <span className="truncate text-neutral-500">— {e.title}</span>}
                  {e.signatureValid === false && (
                    <span className="text-amber-600">⚠ unsigned</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-neutral-500">
              No webhook events received yet. Run{" "}
              <code className="font-mono">node scripts/setup-notifications.mjs</code> to subscribe.
            </p>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-neutral-500">
            Manual pull via GetMyeBaySelling + GetBestOffers. Use this for a full re-sync; the
            live events strip above is the lightweight day-to-day view.
          </p>
          <div className="flex items-center gap-2">
            {data?.fetchedAt && (
              <span className="text-[11px] text-neutral-500">
                last refreshed {new Date(data.fetchedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {loading ? "Polling…" : "Refresh"}
            </button>
          </div>
        </div>

        {error || data?.error ? (
          <p className="text-xs text-red-600">
            {error ?? data?.error}
            {data?.missing && data.missing.length > 0
              ? ` (missing: ${data.missing.join(", ")})`
              : ""}
          </p>
        ) : data && offers.length === 0 ? (
          <p className="text-xs text-neutral-500">No active offers.</p>
        ) : offers.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-2 py-1"></th>
                    <th className="px-2 py-1">Item</th>
                    <th className="px-2 py-1">Offer</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">Buyer</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1">Expires in</th>
                    <th className="px-2 py-1">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((o) => (
                    <tr
                      key={o.bestOfferId}
                      className="border-t border-neutral-100 align-top dark:border-neutral-800"
                    >
                      <td className="px-2 py-1">
                        {o.pictureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={o.pictureUrl}
                            alt=""
                            loading="lazy"
                            className="h-12 w-12 rounded object-cover"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded bg-neutral-100 dark:bg-neutral-800" />
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="text-sm">{o.title}</div>
                        <div className="font-mono text-[11px] text-neutral-500">
                          {o.viewItemUrl ? (
                            <a
                              href={o.viewItemUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {o.itemId}
                            </a>
                          ) : (
                            o.itemId
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1 font-medium">
                        {o.offerPrice} {o.currency}
                      </td>
                      <td className="px-2 py-1">{o.quantity}</td>
                      <td className="px-2 py-1 font-mono text-xs">{o.buyerUserId || "—"}</td>
                      <td className="px-2 py-1 text-xs">{o.status || "—"}</td>
                      <td className="px-2 py-1 text-xs">{formatExpiration(o.expirationTime)}</td>
                      <td className="px-2 py-1 text-xs text-neutral-500">{o.message || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-3 md:hidden">
              {offers.map((o) => (
                <li
                  key={o.bestOfferId}
                  className="rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800"
                >
                  <div className="flex items-start gap-3">
                    {o.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={o.pictureUrl}
                        alt=""
                        loading="lazy"
                        className="w-24 flex-shrink-0 rounded object-contain"
                      />
                    ) : (
                      <div className="aspect-square w-24 flex-shrink-0 rounded bg-neutral-100 dark:bg-neutral-800" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                        {o.title}
                      </p>
                      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                        <dt className="text-neutral-500">Offer</dt>
                        <dd className="font-medium">
                          {o.offerPrice} {o.currency} × {o.quantity}
                        </dd>
                        <dt className="text-neutral-500">Buyer</dt>
                        <dd className="font-mono">{o.buyerUserId || "—"}</dd>
                        <dt className="text-neutral-500">Status</dt>
                        <dd>{o.status || "—"}</dd>
                        <dt className="text-neutral-500">Expires</dt>
                        <dd>{formatExpiration(o.expirationTime)}</dd>
                        <dt className="text-neutral-500">ItemID</dt>
                        <dd className="font-mono">
                          {o.viewItemUrl ? (
                            <a
                              href={o.viewItemUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {o.itemId}
                            </a>
                          ) : (
                            o.itemId
                          )}
                        </dd>
                        {o.message && (
                          <>
                            <dt className="text-neutral-500">Note</dt>
                            <dd className="text-neutral-500">{o.message}</dd>
                          </>
                        )}
                      </dl>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-xs text-neutral-500">Click &ldquo;Refresh&rdquo; to load pending offers.</p>
        )}
      </div>
    </details>
  );
}

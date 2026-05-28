"use client";

import { useApiCall } from "./useApiCall";
import type { OffersResult } from "@/lib/types";

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

export default function OffersPanel() {
  const { data, error, loading, run } = useApiCall<OffersResult>();

  async function refresh() {
    await run("/api/offers", {});
  }

  const offers = data?.offers ?? [];

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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-neutral-500">
            Lists every currently-pending Best Offer across the seller account. Click
            &ldquo;Refresh&rdquo; to re-poll eBay; this app does not auto-poll.
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

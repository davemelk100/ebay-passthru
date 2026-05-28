"use client";

import { useCallback, useEffect, useState } from "react";
import { useRememberedItemId } from "./useRememberedItemId";
import { useApiCall } from "./useApiCall";
import type { InventoryItem, InventoryResult } from "@/lib/types";

const PAGE_SIZE = 10;

export default function FeedView(_props: { env: "sandbox" | "production" }) {
  void _props;
  const {
    data: pull,
    error: pullError,
    loading: pullLoading,
    run: runPull,
    reset: resetPull,
  } = useApiCall<InventoryResult>();
  const [rememberedItemId, setRememberedItemId] = useRememberedItemId();
  const [includeEnded, setIncludeEnded] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);

  const pullFirst = useCallback(
    async (opts?: { silent?: boolean }) => {
      const r = await runPull(
        "/api/inventory",
        { pageNumber: 1, entriesPerPage: PAGE_SIZE, includeEnded },
        { silent: opts?.silent },
      );
      if (r?.ok && r.items) setItems(r.items);
      else if (!r?.ok) setItems([]);
    },
    [includeEnded, runPull],
  );

  const loadMore = useCallback(async () => {
    if (!pull?.ok || !pull.hasMore) return;
    const r = await runPull(
      "/api/inventory",
      { pageNumber: (pull.pageNumber ?? 1) + 1, entriesPerPage: PAGE_SIZE, includeEnded },
      { silent: true },
    );
    if (r?.ok && r.items) setItems((prev) => [...prev, ...r.items!]);
  }, [pull, includeEnded, runPull]);

  // Refetch from page 1 when the include-ended toggle changes after a first pull.
  useEffect(() => {
    if (pull !== null) pullFirst({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeEnded]);

  function clearView() {
    setItems([]);
    resetPull();
  }

  return (
    <details open className="group rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="flex cursor-pointer list-none items-center justify-between p-4 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span className="text-2xl leading-none text-neutral-500 transition-transform group-open:rotate-90">▸</span>
          <h2 className="text-lg font-semibold">Inventory (GetSellerList)</h2>
        </span>
        <span className="text-xs text-neutral-500">
          {pull?.totalEntries !== undefined ? `${items.length} / ${pull.totalEntries}` : ""}
        </span>
      </summary>
      <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-neutral-500">
          Click &ldquo;Pull inventory&rdquo; to fetch the first {PAGE_SIZE} active listings. Use &ldquo;Load more&rdquo; to bring in additional pages.
        </p>
        <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer select-none items-center gap-2">
          <span className="text-xs text-neutral-500">include ended/sold</span>
          <input
            type="checkbox"
            checked={includeEnded}
            onChange={(e) => setIncludeEnded(e.target.checked)}
            disabled={pullLoading}
            className="peer sr-only"
          />
          <span className="relative h-5 w-9 rounded-full bg-neutral-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-disabled:opacity-50 dark:bg-neutral-700" />
        </label>
        <button
          type="button"
          onClick={() => pullFirst()}
          disabled={pullLoading}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pullLoading && items.length === 0 ? "Pulling…" : "Pull inventory"}
        </button>
        <button
          type="button"
          onClick={clearView}
          disabled={pullLoading || (items.length === 0 && pull === null)}
          title="Clears the on-screen table only — does not touch eBay."
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Clear view
        </button>
        </div>
      </div>

      {pull || pullError ? (
        <div className="mb-3">
          {pullError || pull?.error || pull?.missing ? (
            <p className="text-xs text-red-600">
              {pullError ?? pull?.error ?? "Missing env vars: " + (pull?.missing ?? []).join(", ")}
            </p>
          ) : pull ? (
            <>
              <div className="mb-2 flex flex-wrap gap-3 text-xs text-neutral-500">
                <span>
                  Showing: <strong className="text-neutral-700 dark:text-neutral-200">{items.length}</strong>
                  {typeof pull.totalEntries === "number" && pull.totalEntries > items.length
                    ? ` of ${pull.totalEntries}`
                    : ""}
                </span>
                <span>·</span>
                <span>
                  Page {pull.pageNumber}
                  {pull.totalPages ? ` of ${pull.totalPages}` : ""}
                </span>
                <span>·</span>
                <span>{pull.durationMs}ms (last page)</span>
              </div>
              {items.length > 0 ? (
                <div>
                  {/* Desktop / tablet: data table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase text-neutral-500">
                        <tr>
                          <th className="px-2 py-1"></th>
                          <th className="px-2 py-1">ItemID</th>
                          <th className="px-2 py-1">Title</th>
                          <th className="px-2 py-1">SKU</th>
                          <th className="px-2 py-1">Qty</th>
                          <th className="px-2 py-1">Sold</th>
                          <th className="px-2 py-1">Price</th>
                          <th className="px-2 py-1">Status</th>
                          <th className="px-2 py-1">Category</th>
                          <th className="px-2 py-1">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => {
                          const isSelected = rememberedItemId === it.itemId;
                          return (
                            <tr
                              key={it.itemId}
                              className={`border-t border-neutral-100 dark:border-neutral-800 ${
                                isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                              }`}
                            >
                              <td className="px-2 py-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRememberedItemId(isSelected ? null : it.itemId)
                                  }
                                  title={
                                    isSelected
                                      ? "Currently selected — click to unset"
                                      : "Use this ItemID in the call panels / counter-bid engine"
                                  }
                                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                    isSelected
                                      ? "bg-blue-600 text-white"
                                      : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                  }`}
                                >
                                  {isSelected ? "Selected" : "Use"}
                                </button>
                              </td>
                              <td className="px-2 py-1 font-mono text-xs">
                                {it.viewItemUrl ? (
                                  <a
                                    href={it.viewItemUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    {it.itemId}
                                  </a>
                                ) : (
                                  it.itemId
                                )}
                              </td>
                              <td className="px-2 py-1">{it.title}</td>
                              <td className="px-2 py-1 font-mono text-xs">{it.sku}</td>
                              <td className="px-2 py-1">{it.quantity}</td>
                              <td className="px-2 py-1">{it.quantitySold}</td>
                              <td className="px-2 py-1">
                                {it.price} {it.currency}
                              </td>
                              <td className="px-2 py-1 text-xs">
                                <span
                                  className={
                                    it.listingStatus === "Active"
                                      ? "text-green-700 dark:text-green-400"
                                      : "text-neutral-500"
                                  }
                                >
                                  {it.listingStatus || "—"}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-xs text-neutral-500">
                                {it.primaryCategoryName || it.primaryCategoryId}
                              </td>
                              <td className="px-2 py-1">{it.listingType}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile: one <dl> per listing */}
                  <ul className="space-y-3 md:hidden">
                    {items.map((it) => {
                      const isSelected = rememberedItemId === it.itemId;
                      return (
                        <li
                          key={it.itemId}
                          className={`rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800 ${
                            isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {it.pictureUrls?.[0] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={it.pictureUrls[0]}
                                alt=""
                                loading="lazy"
                                className="w-28 flex-shrink-0 rounded object-contain"
                              />
                            ) : (
                              <div className="aspect-square w-28 flex-shrink-0 rounded bg-neutral-100 dark:bg-neutral-800" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex items-start justify-between gap-2">
                                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                                  {it.title}
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRememberedItemId(isSelected ? null : it.itemId)
                                  }
                                  className={`flex-shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
                                    isSelected
                                      ? "bg-blue-600 text-white"
                                      : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                  }`}
                                >
                                  {isSelected ? "Selected" : "Use"}
                                </button>
                              </div>
                              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                            <dt className="text-neutral-500">ItemID</dt>
                            <dd className="font-mono">
                              {it.viewItemUrl ? (
                                <a
                                  href={it.viewItemUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {it.itemId}
                                </a>
                              ) : (
                                it.itemId
                              )}
                            </dd>
                            {it.sku && (
                              <>
                                <dt className="text-neutral-500">SKU</dt>
                                <dd className="font-mono">{it.sku}</dd>
                              </>
                            )}
                            <dt className="text-neutral-500">Qty / Sold</dt>
                            <dd>
                              {it.quantity} / {it.quantitySold}
                            </dd>
                            <dt className="text-neutral-500">Price</dt>
                            <dd>
                              {it.price} {it.currency}
                            </dd>
                            <dt className="text-neutral-500">Status</dt>
                            <dd
                              className={
                                it.listingStatus === "Active"
                                  ? "text-green-700 dark:text-green-400"
                                  : "text-neutral-500"
                              }
                            >
                              {it.listingStatus || "—"}
                            </dd>
                            {(it.primaryCategoryName || it.primaryCategoryId) && (
                              <>
                                <dt className="text-neutral-500">Category</dt>
                                <dd className="text-neutral-500">
                                  {it.primaryCategoryName || it.primaryCategoryId}
                                </dd>
                              </>
                            )}
                            <dt className="text-neutral-500">Type</dt>
                            <dd>{it.listingType}</dd>
                          </dl>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {pull.hasMore && (
                    <div className="mt-3 flex justify-center">
                      <button
                        type="button"
                        onClick={loadMore}
                        disabled={pullLoading}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        {pullLoading ? "Loading…" : `Load ${PAGE_SIZE} more`}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-neutral-500">No items returned.</p>
              )}
            </>
          ) : null}
        </div>
      ) : null}
      </div>
    </details>
  );
}

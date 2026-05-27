"use client";

import { useCallback, useEffect, useState } from "react";
import { useRememberedItemId } from "./useRememberedItemId";
import { useApiCall } from "./useApiCall";
import type { ClearResult, InventoryItem, InventoryResult } from "@/lib/types";

const PAGE_SIZE = 10;

export default function FeedView({ env }: { env: "sandbox" | "production" }) {
  const {
    data: pull,
    error: pullError,
    loading: pullLoading,
    run: runPull,
    reset: resetPull,
  } = useApiCall<InventoryResult>();
  const {
    data: clear,
    error: clearError,
    loading: clearLoading,
    run: runClear,
    reset: resetClear,
  } = useApiCall<ClearResult>();
  const [rememberedItemId, setRememberedItemId] = useRememberedItemId();
  const [includeEnded, setIncludeEnded] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);

  const pullFirst = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) resetClear();
      const r = await runPull(
        "/api/inventory",
        { pageNumber: 1, entriesPerPage: PAGE_SIZE, includeEnded },
        { silent: opts?.silent },
      );
      if (r?.ok && r.items) setItems(r.items);
      else if (!r?.ok) setItems([]);
    },
    [includeEnded, runPull, resetClear],
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

  async function clearAll() {
    const isProd = env === "production";
    const intro = isProd
      ? "⚠️ PRODUCTION ⚠️\n\nThis will END EVERY ACTIVE LISTING on the real eBay seller account.\nThis cannot be undone."
      : "This will end every active sandbox listing.";
    const challenge = isProd ? "CLEAR PRODUCTION" : "CLEAR";
    const typed = window.prompt(`${intro}\n\nType "${challenge}" to proceed:`);
    if (typed !== challenge) return;

    resetPull();
    setItems([]);
    await runClear("/api/inventory/clear", isProd ? { allowProduction: true } : {});
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Inventory (GetSellerList)</h2>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer select-none items-center gap-2">
            <span className="text-xs text-neutral-500">include ended/sold</span>
            <input
              type="checkbox"
              checked={includeEnded}
              onChange={(e) => setIncludeEnded(e.target.checked)}
              disabled={pullLoading || clearLoading}
              className="peer sr-only"
            />
            <span className="relative h-5 w-9 rounded-full bg-neutral-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-disabled:opacity-50 dark:bg-neutral-700" />
          </label>
          <button
            type="button"
            onClick={() => pullFirst()}
            disabled={pullLoading || clearLoading}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {pullLoading && items.length === 0 ? "Pulling…" : "Pull inventory"}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={pullLoading || clearLoading}
            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300"
          >
            {clearLoading ? "Clearing…" : env === "production" ? "Clear inventory (PROD)" : "Clear inventory"}
          </button>
        </div>
      </header>

      {(clear || clearError) && (
        <div className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
          {clearError || clear?.error ? (
            <p className="text-xs text-red-600">
              {clearError ?? clear?.error}
              {clear?.hint && <span className="block text-neutral-500">{clear.hint}</span>}
              {clear?.missing && <span className="block">Missing: {clear.missing.join(", ")}</span>}
            </p>
          ) : clear ? (
            <div className="text-xs">
              <div className="mb-1 flex flex-wrap gap-3 text-neutral-500">
                <span>
                  Found: <strong className="text-neutral-700 dark:text-neutral-200">{clear.foundCount}</strong>
                </span>
                <span>·</span>
                <span>
                  Ended: <strong className="text-green-700 dark:text-green-400">{clear.endedCount}</strong>
                </span>
                {clear.failedCount ? (
                  <>
                    <span>·</span>
                    <span>
                      Failed: <strong className="text-red-700 dark:text-red-400">{clear.failedCount}</strong>
                    </span>
                  </>
                ) : null}
                <span>·</span>
                <span>{clear.durationMs}ms</span>
              </div>
              {clear.results && clear.results.some((r) => !r.ended) && (
                <ul className="mt-2 space-y-1">
                  {clear.results
                    .filter((r) => !r.ended)
                    .map((r) => (
                      <li key={r.itemId} className="font-mono text-[11px] text-red-600">
                        {r.itemId} — failed{" "}
                        {r.errors.map((e) => e.shortMessage).filter(Boolean).join("; ")}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}

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
                <div className="overflow-x-auto">
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
                                onClick={() => setRememberedItemId(isSelected ? null : it.itemId)}
                                title={
                                  isSelected
                                    ? "Currently selected — click to unset"
                                    : "Use this ItemID in GetItem / ReviseItem / EndItem"
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
                  {pull.hasMore && (
                    <div className="mt-3 flex justify-center">
                      <button
                        type="button"
                        onClick={loadMore}
                        disabled={pullLoading || clearLoading}
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
      ) : (
        <p className="text-xs text-neutral-500">
          Click &ldquo;Pull inventory&rdquo; to fetch the first {PAGE_SIZE} active listings. Use &ldquo;Load more&rdquo; to bring in additional pages.
        </p>
      )}
    </section>
  );
}

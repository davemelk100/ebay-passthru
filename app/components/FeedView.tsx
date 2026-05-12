"use client";

import { useCallback, useEffect, useState } from "react";
import { useRememberedItemId } from "./useRememberedItemId";

interface InventoryItem {
  itemId: string;
  title: string;
  sku: string;
  quantity: number;
  quantitySold: number;
  price: string;
  currency: string;
  listingType: string;
  listingStatus: string;
  timeLeft: string;
  viewItemUrl: string;
  startTime: string;
  endTime: string;
  primaryCategoryId: string;
  primaryCategoryName: string;
  pictureUrls: string[];
}

interface InventoryResult {
  ok: boolean;
  fetched: number;
  totalEntries?: number;
  pagesFetched: number;
  totalPages?: number;
  truncated?: boolean;
  durationMs: number;
  items?: InventoryItem[];
  errors?: { code?: string; shortMessage?: string; longMessage?: string }[];
  error?: string;
  missing?: string[];
  stoppedOnPage?: number;
}

interface ClearResult {
  ok: boolean;
  foundCount?: number;
  endedCount?: number;
  failedCount?: number;
  durationMs?: number;
  results?: { itemId: string; ended: boolean; ack?: string; errors: unknown[] }[];
  error?: string;
  missing?: string[];
  hint?: string;
}

export default function FeedView({ env }: { env: "sandbox" | "production" }) {
  const [pullLoading, setPullLoading] = useState(false);
  const [pull, setPull] = useState<InventoryResult | null>(null);
  const [clearLoading, setClearLoading] = useState(false);
  const [clear, setClear] = useState<ClearResult | null>(null);
  const [rememberedItemId, setRememberedItemId] = useRememberedItemId();
  const [includeEnded, setIncludeEnded] = useState(false);

  const pullAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      setPullLoading(true);
      if (!opts?.silent) {
        setPull(null);
        setClear(null);
      }
      try {
        const res = await fetch("/api/inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entriesPerPage: 100, includeEnded }),
        });
        const data = (await res.json()) as InventoryResult;
        setPull(data);
      } catch (e) {
        setPull({
          ok: false,
          fetched: 0,
          pagesFetched: 0,
          durationMs: 0,
          error: (e as Error).message,
        });
      } finally {
        setPullLoading(false);
      }
    },
    [includeEnded],
  );

  // Auto-refresh when the user toggles include-ended after the first pull.
  // The leading `pull !== null` guard avoids firing on initial mount.
  useEffect(() => {
    if (pull !== null) pullAll({ silent: true });
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

    setClearLoading(true);
    setClear(null);
    setPull(null);
    try {
      const res = await fetch("/api/inventory/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isProd ? { allowProduction: true } : {}),
      });
      const data = (await res.json()) as ClearResult;
      setClear(data);
    } catch (e) {
      setClear({ ok: false, error: (e as Error).message });
    } finally {
      setClearLoading(false);
    }
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
            onClick={() => pullAll()}
            disabled={pullLoading || clearLoading}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {pullLoading ? "Pulling…" : "Pull full inventory"}
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

      {clear && (
        <div className="mb-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
          {clear.error ? (
            <p className="text-xs text-red-600">
              {clear.error}
              {clear.hint && <span className="block text-neutral-500">{clear.hint}</span>}
              {clear.missing && <span className="block">Missing: {clear.missing.join(", ")}</span>}
            </p>
          ) : (
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
                        {(r.errors as { shortMessage?: string }[])
                          .map((e) => e.shortMessage)
                          .filter(Boolean)
                          .join("; ")}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {pull ? (
        <div className="mb-3">
          {pull.error || pull.missing ? (
            <p className="text-xs text-red-600">
              {pull.error ?? "Missing env vars: " + (pull.missing ?? []).join(", ")}
            </p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-3 text-xs text-neutral-500">
                <span>
                  Fetched: <strong className="text-neutral-700 dark:text-neutral-200">{pull.fetched}</strong>
                  {typeof pull.totalEntries === "number" && pull.totalEntries !== pull.fetched
                    ? ` / ${pull.totalEntries}`
                    : ""}
                </span>
                <span>·</span>
                <span>
                  Pages: {pull.pagesFetched}
                  {pull.totalPages && pull.totalPages !== pull.pagesFetched ? ` of ${pull.totalPages}` : ""}
                </span>
                <span>·</span>
                <span>{pull.durationMs}ms</span>
                {pull.truncated && (
                  <>
                    <span>·</span>
                    <span className="text-amber-600">truncated (raise maxPages on server)</span>
                  </>
                )}
              </div>
              {pull.items && pull.items.length > 0 ? (
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
                      {pull.items.map((it) => {
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
                </div>
              ) : (
                <p className="text-xs text-neutral-500">No items returned.</p>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          Click &ldquo;Pull full inventory&rdquo; to fetch every active listing. Toggle &ldquo;include ended/sold&rdquo; to also surface recently-ended items.
        </p>
      )}
    </section>
  );
}

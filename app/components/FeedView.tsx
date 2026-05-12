"use client";

import { useState } from "react";

interface ActiveListItem {
  ItemID?: string | number;
  Title?: string;
  Quantity?: string | number;
  SellingStatus?: { CurrentPrice?: { "#text"?: string | number } | string | number };
  TimeLeft?: string;
  ListingType?: string;
}

interface FeedResult {
  ok: boolean;
  ack?: string;
  rawXml: string;
  parsed: unknown;
  errors: { code?: string; shortMessage?: string; longMessage?: string }[];
  error?: string;
  missing?: string[];
}

interface InventoryItem {
  itemId: string;
  title: string;
  sku: string;
  quantity: number;
  quantitySold: number;
  price: string;
  currency: string;
  listingType: string;
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

export default function FeedView() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FeedResult | null>(null);
  const [pullLoading, setPullLoading] = useState(false);
  const [pull, setPull] = useState<InventoryResult | null>(null);

  async function load() {
    setLoading(true);
    setResult(null);
    setPull(null);
    try {
      const res = await fetch("/api/ebay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callName: "GetMyeBaySelling",
          xml: `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>25</EntriesPerPage><PageNumber>1</PageNumber></Pagination></ActiveList>`,
        }),
      });
      const data = (await res.json()) as FeedResult;
      setResult(data);
    } catch (e) {
      setResult({
        ok: false,
        rawXml: "",
        parsed: null,
        errors: [],
        error: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }

  async function pullAll() {
    setPullLoading(true);
    setPull(null);
    setResult(null);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entriesPerPage: 100 }),
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
  }

  const items = extractActiveItems(result?.parsed);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Feed (GetMyeBaySelling · ActiveList)</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading || pullLoading}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {loading ? "Loading…" : "Load page 1"}
          </button>
          <button
            type="button"
            onClick={pullAll}
            disabled={loading || pullLoading}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {pullLoading ? "Pulling…" : "Pull full inventory"}
          </button>
        </div>
      </header>

      {result?.error && (
        <p className="text-xs text-red-600">Error: {result.error}</p>
      )}
      {result?.missing && result.missing.length > 0 && (
        <p className="text-xs text-amber-600">
          Missing env vars: {result.missing.join(", ")}
        </p>
      )}

      {pull && (
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
                  {pull.totalPages && pull.totalPages !== pull.pagesFetched
                    ? ` of ${pull.totalPages}`
                    : ""}
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
                        <th className="px-2 py-1">ItemID</th>
                        <th className="px-2 py-1">Title</th>
                        <th className="px-2 py-1">SKU</th>
                        <th className="px-2 py-1">Qty</th>
                        <th className="px-2 py-1">Sold</th>
                        <th className="px-2 py-1">Price</th>
                        <th className="px-2 py-1">Category</th>
                        <th className="px-2 py-1">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pull.items.map((it) => (
                        <tr key={it.itemId} className="border-t border-neutral-100 dark:border-neutral-800">
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
                          <td className="px-2 py-1 text-xs text-neutral-500">
                            {it.primaryCategoryName || it.primaryCategoryId}
                          </td>
                          <td className="px-2 py-1">{it.listingType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">No items returned.</p>
              )}
            </>
          )}
        </div>
      )}

      {!pull && items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">ItemID</th>
                <th className="px-2 py-1">Title</th>
                <th className="px-2 py-1">Qty</th>
                <th className="px-2 py-1">Price</th>
                <th className="px-2 py-1">Time left</th>
                <th className="px-2 py-1">Type</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-2 py-1 font-mono text-xs">{String(it.ItemID ?? "")}</td>
                  <td className="px-2 py-1">{it.Title}</td>
                  <td className="px-2 py-1">{String(it.Quantity ?? "")}</td>
                  <td className="px-2 py-1">{formatPrice(it.SellingStatus)}</td>
                  <td className="px-2 py-1">{it.TimeLeft}</td>
                  <td className="px-2 py-1">{it.ListingType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !pull && result ? (
        <p className="text-xs text-neutral-500">
          No active items to show. (Ack: {result.ack ?? "—"})
        </p>
      ) : !pull && !result ? (
        <p className="text-xs text-neutral-500">
          Click “Load page 1” for a quick sample or “Pull full inventory” to fetch every active listing.
        </p>
      ) : null}
    </section>
  );
}

function extractActiveItems(parsed: unknown): ActiveListItem[] {
  const root = parsed as Record<string, unknown> | null;
  const resp = root?.GetMyeBaySellingResponse as Record<string, unknown> | undefined;
  const active = resp?.ActiveList as Record<string, unknown> | undefined;
  const itemArray = active?.ItemArray as Record<string, unknown> | undefined;
  const items = itemArray?.Item;
  if (!items) return [];
  return (Array.isArray(items) ? items : [items]) as ActiveListItem[];
}

function formatPrice(status: ActiveListItem["SellingStatus"]): string {
  if (!status) return "";
  const cp = status.CurrentPrice;
  if (typeof cp === "object" && cp && "#text" in cp) return String((cp as { "#text": unknown })["#text"] ?? "");
  return String(cp ?? "");
}

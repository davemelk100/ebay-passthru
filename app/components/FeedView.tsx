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

export default function FeedView() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FeedResult | null>(null);

  async function load() {
    setLoading(true);
    setResult(null);
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

  const items = extractActiveItems(result?.parsed);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Feed (GetMyeBaySelling · ActiveList)</h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {loading ? "Loading…" : "Load feed"}
        </button>
      </header>

      {result?.error && (
        <p className="text-xs text-red-600">Error: {result.error}</p>
      )}
      {result?.missing && result.missing.length > 0 && (
        <p className="text-xs text-amber-600">
          Missing env vars: {result.missing.join(", ")}
        </p>
      )}

      {items.length > 0 ? (
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
      ) : result ? (
        <p className="text-xs text-neutral-500">
          No active items to show. (Ack: {result.ack ?? "—"})
        </p>
      ) : (
        <p className="text-xs text-neutral-500">Click “Load feed” to fetch active listings.</p>
      )}
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

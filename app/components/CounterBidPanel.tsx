"use client";

import { useState } from "react";
import { useRememberedItemId } from "./useRememberedItemId";

type ActionType = "accept" | "decline" | "counter" | "no-match";

interface DecisionPayload {
  action: ActionType;
  matchedRule?: string;
  message?: string;
  counterPrice?: number;
  counterQuantity?: number;
  reason?: string;
  priceSource?: { stat?: string; usedFallback?: boolean; value: number };
}

interface PreviewRow {
  itemId: string;
  bestOfferId: string;
  buyerUserId?: string;
  offerPrice: number;
  listingPrice: number;
  quantity: number;
  decision: DecisionPayload;
}

interface PreviewResponse {
  ok?: boolean;
  error?: string;
  mode?: string;
  itemId?: string;
  title?: string;
  listingPrice?: number;
  offerCount?: number;
  ruleCount?: number;
  rulesPath?: string;
  compsCount?: number;
  results?: PreviewRow[];
}

interface ApplyResult {
  ok?: boolean;
  appliedCount?: number;
  failedCount?: number;
  durationMs?: number;
  error?: string;
  hint?: string;
  results?: { itemId: string; bestOfferId: string; action: string; ok: boolean; ack?: string; errors: { shortMessage?: string }[] }[];
}

interface Override {
  action: ActionType;
  counterPrice?: number;
  counterQuantity?: number;
  message?: string;
}

export default function CounterBidPanel({ env }: { env: "sandbox" | "production" }) {
  const [rememberedItemId] = useRememberedItemId();
  const [itemId, setItemId] = useState<string>("");
  const [compsText, setCompsText] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const effectiveItemId = itemId.trim() || rememberedItemId || "";

  async function runPreview() {
    if (!effectiveItemId) {
      setPreview({ error: "Set an ItemID (or click Use on a row in the Inventory table)." });
      return;
    }
    const comps = compsText
      .split(/[,\s]+/)
      .map((s) => Number.parseFloat(s))
      .filter((n) => Number.isFinite(n) && n > 0);

    setPreviewLoading(true);
    setPreview(null);
    setOverrides({});
    setApplyResult(null);
    try {
      const res = await fetch("/api/counter-bid/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: effectiveItemId, comps }),
      });
      const data = (await res.json()) as PreviewResponse;
      setPreview(data);
      if (data.results) {
        const seeded: Record<string, Override> = {};
        for (const r of data.results) {
          if (r.decision.action === "no-match") continue;
          seeded[r.bestOfferId] = {
            action: r.decision.action,
            counterPrice: r.decision.counterPrice,
            counterQuantity: r.decision.counterQuantity,
            message: r.decision.message,
          };
        }
        setOverrides(seeded);
      }
    } catch (e) {
      setPreview({ error: (e as Error).message });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function applyDecisions() {
    if (!preview?.results || preview.results.length === 0) return;
    const isProd = env === "production";
    const intro = isProd
      ? `⚠️ PRODUCTION ⚠️\n\nThis will send RespondToBestOffer for ${Object.keys(overrides).length} offer(s) on the real seller account.`
      : `This will send RespondToBestOffer for ${Object.keys(overrides).length} offer(s) on the sandbox account.`;
    if (!window.confirm(`${intro}\n\nProceed?`)) return;

    const decisions = preview.results
      .filter((r) => overrides[r.bestOfferId])
      .map((r) => {
        const o = overrides[r.bestOfferId];
        return {
          itemId: r.itemId,
          bestOfferId: r.bestOfferId,
          action: o.action,
          counterPrice: o.counterPrice,
          counterQuantity: o.counterQuantity,
          message: o.message,
        };
      });

    setApplyLoading(true);
    setApplyResult(null);
    try {
      const res = await fetch("/api/counter-bid/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions, ...(isProd ? { allowProduction: true } : {}) }),
      });
      const data = (await res.json()) as ApplyResult;
      setApplyResult(data);
    } catch (e) {
      setApplyResult({ error: (e as Error).message });
    } finally {
      setApplyLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Counter-bid engine</h2>
        <span className="text-xs text-neutral-500">rules: lib/counter-bid-rules.json</span>
      </header>

      <div className="mb-3 grid gap-2 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">
            ItemID {rememberedItemId && !itemId ? `(default: ${rememberedItemId})` : ""}
          </label>
          <input
            type="text"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            placeholder={rememberedItemId ?? "Paste an ItemID or use the Use button in Inventory"}
            className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">
            Comparable sale prices (comma- or space-separated)
          </label>
          <input
            type="text"
            value={compsText}
            onChange={(e) => setCompsText(e.target.value)}
            placeholder="e.g. 18.50, 21.00, 19.75, 22.10, 17.95"
            className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={previewLoading || applyLoading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {previewLoading ? "Evaluating…" : "Preview decisions"}
        </button>
        {preview?.results && preview.results.length > 0 && (
          <button
            type="button"
            onClick={applyDecisions}
            disabled={applyLoading}
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
          >
            {applyLoading
              ? "Applying…"
              : env === "production"
                ? "Apply (PROD)"
                : "Apply decisions"}
          </button>
        )}
      </div>

      {preview?.error && (
        <p className="mb-2 text-xs text-red-600">{preview.error}</p>
      )}

      {preview && !preview.error && (
        <div className="mb-3 text-xs text-neutral-500">
          {preview.title && <div className="mb-1">Listing: {preview.title}</div>}
          <div>
            ListingPrice: <strong>{preview.listingPrice}</strong> · Offers:{" "}
            <strong>{preview.offerCount}</strong> · Rules: {preview.ruleCount} · Comps:{" "}
            {preview.compsCount ?? 0}
          </div>
        </div>
      )}

      {preview?.results && preview.results.length === 0 && (
        <p className="text-xs text-neutral-500">No active offers on this item.</p>
      )}

      {preview?.results && preview.results.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">Buyer</th>
                <th className="px-2 py-1">Offer</th>
                <th className="px-2 py-1">Ratio</th>
                <th className="px-2 py-1">Matched rule</th>
                <th className="px-2 py-1">Action</th>
                <th className="px-2 py-1">Counter $</th>
                <th className="px-2 py-1">Message</th>
              </tr>
            </thead>
            <tbody>
              {preview.results.map((r) => {
                const ov = overrides[r.bestOfferId];
                const action = ov?.action ?? r.decision.action;
                const ratio = r.listingPrice > 0 ? (r.offerPrice / r.listingPrice).toFixed(2) : "—";
                return (
                  <tr key={r.bestOfferId} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-2 py-1 font-mono text-xs">{r.buyerUserId ?? "—"}</td>
                    <td className="px-2 py-1">${r.offerPrice}</td>
                    <td className="px-2 py-1">{ratio}</td>
                    <td className="px-2 py-1 text-xs text-neutral-500">
                      {r.decision.matchedRule ?? r.decision.reason ?? "—"}
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={action}
                        onChange={(e) => {
                          const next = e.target.value as ActionType;
                          setOverrides((prev) => {
                            const copy = { ...prev };
                            if (next === "no-match") {
                              delete copy[r.bestOfferId];
                            } else {
                              copy[r.bestOfferId] = {
                                ...(copy[r.bestOfferId] ?? {
                                  action: next,
                                  counterPrice: r.decision.counterPrice,
                                  counterQuantity: r.decision.counterQuantity ?? 1,
                                  message: r.decision.message,
                                }),
                                action: next,
                              };
                            }
                            return copy;
                          });
                        }}
                        className="rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                      >
                        <option value="accept">accept</option>
                        <option value="decline">decline</option>
                        <option value="counter">counter</option>
                        <option value="no-match">skip</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      {action === "counter" ? (
                        <input
                          type="number"
                          step="0.01"
                          value={ov?.counterPrice ?? r.decision.counterPrice ?? ""}
                          onChange={(e) => {
                            const v = Number.parseFloat(e.target.value);
                            setOverrides((prev) => ({
                              ...prev,
                              [r.bestOfferId]: {
                                ...(prev[r.bestOfferId] ?? { action: "counter" }),
                                action: "counter",
                                counterPrice: Number.isFinite(v) ? v : 0,
                              },
                            }));
                          }}
                          className="w-20 rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-right font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
                        />
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {(action === "counter" || action === "decline") && (
                        <input
                          type="text"
                          value={ov?.message ?? r.decision.message ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setOverrides((prev) => ({
                              ...prev,
                              [r.bestOfferId]: {
                                ...(prev[r.bestOfferId] ?? { action }),
                                action,
                                message: v,
                              },
                            }));
                          }}
                          className="w-full min-w-[12rem] rounded border border-neutral-300 bg-neutral-50 px-1 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {applyResult && (
        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
          {applyResult.error ? (
            <p className="text-red-600">
              {applyResult.error}
              {applyResult.hint && <span className="block text-neutral-500">{applyResult.hint}</span>}
            </p>
          ) : (
            <>
              <div className="mb-1 text-neutral-500">
                Applied:{" "}
                <strong className="text-green-700 dark:text-green-400">
                  {applyResult.appliedCount}
                </strong>
                {applyResult.failedCount ? (
                  <>
                    {" "}
                    · Failed:{" "}
                    <strong className="text-red-700 dark:text-red-400">{applyResult.failedCount}</strong>
                  </>
                ) : null}{" "}
                · {applyResult.durationMs}ms
              </div>
              {applyResult.results &&
                applyResult.results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <div key={r.bestOfferId} className="font-mono text-[11px] text-red-600">
                      {r.bestOfferId} → {r.action} failed:{" "}
                      {r.errors.map((e) => e.shortMessage).filter(Boolean).join("; ")}
                    </div>
                  ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { useRememberedItemId } from "./useRememberedItemId";
import { useApiCall } from "./useApiCall";
import { OfferTable, type Override } from "./counter-bid/OfferTable";
import { ApplyResult } from "./counter-bid/ApplyResult";
import type { ApplyResponse, PreviewResponse } from "@/lib/types";

const SYNTHETIC_PLACEHOLDER = `[
  {"bestOfferId":"O1","buyerUserId":"alice","offerPrice":140,"listingPrice":175,"quantity":1,"grade":{"company":"PSA","score":10,"raw":"PSA 10"}},
  {"bestOfferId":"O2","buyerUserId":"bob","offerPrice":110,"listingPrice":140,"quantity":1,"grade":{"company":"BGS","score":9.5,"raw":"BGS 9.5"}},
  {"bestOfferId":"O3","buyerUserId":"carl","offerPrice":15,"listingPrice":80,"quantity":1}
]`;

type Mode = "live" | "synthetic";

export default function CounterBidPanel({ env }: { env: "sandbox" | "production" }) {
  const [mode, setMode] = useState<Mode>("live");
  const [rememberedItemId] = useRememberedItemId();
  const [itemId, setItemId] = useState<string>("");
  const [compsText, setCompsText] = useState<string>("");
  const [offersText, setOffersText] = useState<string>(SYNTHETIC_PLACEHOLDER);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const previewCall = useApiCall<PreviewResponse>();
  const applyCall = useApiCall<ApplyResponse>();
  const {
    data: preview,
    error: previewError,
    loading: previewLoading,
    run: runPreviewCall,
    reset: resetPreview,
    setError: setPreviewError,
  } = previewCall;
  const {
    data: applyResult,
    error: applyError,
    loading: applyLoading,
    run: runApplyCall,
    reset: resetApply,
  } = applyCall;

  const effectiveItemId = itemId.trim() || rememberedItemId || "";

  function seedOverridesFromPreview(data: PreviewResponse | null) {
    if (!data?.results) return;
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

  async function runPreview() {
    const comps = compsText
      .split(/[,\s]+/)
      .map((s) => Number.parseFloat(s))
      .filter((n) => Number.isFinite(n) && n > 0);

    setOverrides({});
    resetApply();

    if (mode === "synthetic") {
      let offers: unknown;
      try {
        offers = JSON.parse(offersText);
      } catch (e) {
        setPreviewError(`Offers JSON is invalid: ${(e as Error).message}`);
        return;
      }
      if (!Array.isArray(offers) || offers.length === 0) {
        setPreviewError("Offers JSON must be a non-empty array.");
        return;
      }
      // Normalize: each offer needs an itemId; default to "SYNTHETIC".
      const normalized = (offers as Record<string, unknown>[]).map((o, i) => ({
        itemId: typeof o.itemId === "string" ? o.itemId : "SYNTHETIC",
        bestOfferId: typeof o.bestOfferId === "string" ? o.bestOfferId : `synth-${i}`,
        ...o,
      }));
      const data = await runPreviewCall("/api/counter-bid/preview", { offers: normalized, comps });
      seedOverridesFromPreview(data);
      return;
    }

    if (!effectiveItemId) {
      setPreviewError("Set an ItemID (or click Use on a row in the Inventory table).");
      return;
    }

    const data = await runPreviewCall("/api/counter-bid/preview", {
      itemId: effectiveItemId,
      comps,
    });
    seedOverridesFromPreview(data);
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

    await runApplyCall("/api/counter-bid/apply", {
      decisions,
      ...(isProd ? { allowProduction: true } : {}),
    });
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Counter-bid engine</h2>
        <span className="text-xs text-neutral-500">rules: lib/counter-bid-rules.json</span>
      </header>

      <div className="mb-3 inline-flex rounded-md border border-neutral-300 p-0.5 text-xs dark:border-neutral-700">
        {(["live", "synthetic"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              resetPreview();
              setOverrides({});
              resetApply();
            }}
            className={`rounded px-3 py-1 font-medium ${
              mode === m
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {m === "live" ? "Live offers" : "Synthetic"}
          </button>
        ))}
      </div>

      {mode === "live" ? (
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
      ) : (
        <div className="mb-3 space-y-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Synthetic offers (JSON array). No real listings or buyers needed — just exercise the rules.
            </label>
            <textarea
              value={offersText}
              onChange={(e) => setOffersText(e.target.value)}
              rows={8}
              spellCheck={false}
              className="w-full rounded-md border border-neutral-300 bg-neutral-50 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
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
      )}

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={previewLoading || applyLoading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {previewLoading ? "Evaluating…" : "Preview decisions"}
        </button>
        {mode === "live" && preview?.results && preview.results.length > 0 && (
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
        {mode === "synthetic" && preview?.results && preview.results.length > 0 && (
          <span className="text-xs text-neutral-500">
            Apply is disabled in synthetic mode — these offers aren&apos;t real.
          </span>
        )}
      </div>

      {(previewError || preview?.error) && (
        <p className="mb-2 text-xs text-red-600">{previewError ?? preview?.error}</p>
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
        <OfferTable
          results={preview.results}
          overrides={overrides}
          setOverrides={setOverrides}
        />
      )}

      <ApplyResult data={applyResult} error={applyError} />
    </section>
  );
}

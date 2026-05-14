"use client";

import { useState } from "react";
import { useApiCall } from "./useApiCall";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface SellResult {
  ok?: boolean;
  status?: number;
  body?: unknown;
  rawText?: string;
  durationMs?: number;
  endpoint?: string;
  error?: string;
  hint?: string;
  missing?: string[];
}

interface Sample {
  label: string;
  method: Method;
  path: string;
  body?: string;
  hint?: string;
}

const SAMPLES: Sample[] = [
  {
    label: "InventoryItems",
    method: "GET",
    path: "/sell/inventory/v1/inventory_item?limit=20&offset=0",
    hint: "Paginated inventory (Sell Inventory API). Empty for sellers managing listings via Trading API only — populate by sync'ing items into the inventory system.",
  },
  {
    label: "PaymentPolicies",
    method: "GET",
    path: "/sell/account/v1/payment_policy?marketplace_id=EBAY_US",
    hint: "⚠️ Requires Business Policy opt-in (free, one-time, at https://www.bizpolicy.ebay.com). Returns 20403 \"User is not eligible for Business Policy\" otherwise.",
  },
  {
    label: "FulfillmentPolicies",
    method: "GET",
    path: "/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US",
    hint: "⚠️ Requires Business Policy opt-in (same as PaymentPolicies above). Returns 20403 otherwise.",
  },
  {
    label: "Orders",
    method: "GET",
    path: "/sell/fulfillment/v1/order?limit=20",
    hint: "Recent orders for this seller.",
  },
];

export default function SellPanel({ env }: { env: "sandbox" | "production" }) {
  const [method, setMethod] = useState<Method>("GET");
  const [path, setPath] = useState<string>(SAMPLES[0].path);
  const [body, setBody] = useState<string>("");
  const { data: result, error, loading, run, reset, setError } = useApiCall<SellResult>();
  const [activeSample, setActiveSample] = useState<string>(SAMPLES[0].label);

  function pickSample(s: Sample) {
    setActiveSample(s.label);
    setMethod(s.method);
    setPath(s.path);
    setBody(s.body ?? "");
    reset();
  }

  async function send() {
    const isMutating = method !== "GET";
    const allowProduction = env === "production" && isMutating;
    if (allowProduction) {
      const ok = window.confirm(
        `⚠️ You're on PRODUCTION.\n\n${method} ${path} may mutate real seller data.\nProceed?`,
      );
      if (!ok) return;
    }

    let parsedBody: unknown = undefined;
    if (isMutating && body.trim().length > 0) {
      try {
        parsedBody = JSON.parse(body);
      } catch (e) {
        setError(`Body must be valid JSON. ${(e as Error).message}`);
        return;
      }
    }

    await run("/api/sell", {
      method,
      path,
      ...(parsedBody !== undefined ? { body: parsedBody } : {}),
      ...(allowProduction ? { allowProduction: true } : {}),
    });
  }

  const sample = SAMPLES.find((s) => s.label === activeSample);
  const bodyAllowed = method !== "GET" && method !== "DELETE";

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sell REST API passthrough</h2>
        <span className="text-xs text-neutral-500">JSON in → JSON out</span>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => pickSample(s)}
            className={`rounded-full border px-3 py-1 text-xs ${
              activeSample === s.label
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-neutral-300 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sample?.hint && (
        <p className="mb-2 text-xs text-neutral-500">{sample.hint}</p>
      )}

      <div className="mb-2 flex gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          className="rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs font-mono dark:border-neutral-700 dark:bg-neutral-950"
        >
          {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          spellCheck={false}
          placeholder="/sell/inventory/v1/inventory_item"
          className="flex-1 rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
        />
      </div>

      {bodyAllowed && (
        <>
          <label className="mb-1 block text-xs font-medium text-neutral-500">
            Request body (JSON)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder='{ "field": "value" }'
            className="mb-2 w-full rounded-md border border-neutral-300 bg-neutral-50 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
          />
        </>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Sending…" : `Send ${method}`}
        </button>
        {result && result.status !== undefined && (
          <span className="text-xs text-neutral-500">
            HTTP {result.status} · {result.durationMs}ms ·{" "}
            <strong className={result.ok ? "text-green-600" : "text-red-600"}>
              {result.ok ? "OK" : "FAIL"}
            </strong>
          </span>
        )}
      </div>

      {(result || error) && (
        <div className="mt-3">
          {(error || result?.error) && (
            <p className="mb-2 text-xs text-red-600">
              {error ?? result?.error}
              {result?.hint && (
                <span className="block text-neutral-500">{result.hint}</span>
              )}
              {result?.missing && (
                <span className="block">Missing: {result.missing.join(", ")}</span>
              )}
            </p>
          )}
          {result?.body !== undefined && (
            <pre className="max-h-96 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] dark:border-neutral-800 dark:bg-neutral-950">
              {typeof result.body === "string"
                ? result.body
                : JSON.stringify(result.body, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

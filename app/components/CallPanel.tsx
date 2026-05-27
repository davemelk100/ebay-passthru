"use client";

import { useState } from "react";
import { DESTRUCTIVE_CALLS, SAMPLE_BODIES } from "@/lib/samples";
import { useRememberedItemId } from "./useRememberedItemId";
import { useApiCall } from "./useApiCall";

const CALLS = Object.keys(SAMPLE_BODIES);
const PLACEHOLDER = "REPLACE_WITH_ITEM_ID";

function substituteItemId(xml: string, itemId: string | null): string {
  if (!itemId) return xml;
  return xml.split(PLACEHOLDER).join(itemId);
}

interface ApiResult {
  ok: boolean;
  status: number;
  ack?: string;
  errors: { code?: string; shortMessage?: string; longMessage?: string }[];
  rawXml: string;
  parsed: unknown;
  endpoint: string;
  durationMs: number;
  error?: string;
  missing?: string[];
  hint?: string;
}

export default function CallPanel({ env }: { env: "sandbox" | "production" }) {
  const [callName, setCallName] = useState<string>("GetUser");
  const [xml, setXml] = useState<string>(SAMPLE_BODIES.GetUser ?? "");
  const { data: result, error, loading, run, reset } = useApiCall<ApiResult>();
  const [rememberedItemId, setRememberedItemId] = useRememberedItemId();

  function pickCall(name: string) {
    setCallName(name);
    setXml(substituteItemId(SAMPLE_BODIES[name] ?? "", rememberedItemId));
    reset();
  }

  async function send() {
    // Belt-and-suspenders: the server hard-blocks destructive calls in prod
    // and rejects anything outside the read-only allowlist, but bail early
    // here too if something snuck back into the sample list.
    if (env === "production" && DESTRUCTIVE_CALLS.has(callName)) return;
    await run("/api/ebay", { callName, xml });
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Trading API passthrough</h2>
        <span className="text-xs text-neutral-500">XML in → XML out</span>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {CALLS.map((c) => {
          const blocked = env === "production" && DESTRUCTIVE_CALLS.has(c);
          const isSelected = callName === c;
          const button = (
            <button
              type="button"
              onClick={() => pickCall(c)}
              disabled={blocked}
              className={`rounded-full border px-3 py-1 text-xs ${
                blocked
                  ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400 line-through dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-600"
                  : isSelected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-neutral-300 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              }`}
            >
              {c}
            </button>
          );
          if (!blocked) return <span key={c}>{button}</span>;
          return (
            <span key={c} className="group relative inline-block">
              {button}
              <span
                role="tooltip"
                className="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
              >
                ⚠ {c} mutates real seller data — disabled in production
                <span className="absolute left-1/2 top-full -mt-px h-0 w-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-neutral-900 dark:border-t-neutral-100" />
              </span>
            </span>
          );
        })}
      </div>

      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs font-medium text-neutral-500">
          Inner XML (request body — credentials auto-injected)
        </label>
        {rememberedItemId && (
          <span className="text-xs text-neutral-500">
            Saved ItemID:{" "}
            <code className="font-mono text-neutral-700 dark:text-neutral-300">
              {rememberedItemId}
            </code>{" "}
            <button
              type="button"
              onClick={() => setRememberedItemId(null)}
              className="ml-1 text-blue-600 hover:underline"
            >
              clear
            </button>
          </span>
        )}
      </div>
      <textarea
        value={xml}
        onChange={(e) => setXml(e.target.value)}
        rows={10}
        spellCheck={false}
        className="w-full rounded-md border border-neutral-300 bg-neutral-50 p-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Sending…" : `Send ${callName}`}
        </button>
        {(result || error) && (
          <span className="text-xs text-neutral-500">
            {result ? (
              <>
                HTTP {result.status} · {result.durationMs}ms · Ack:{" "}
                <strong className={result.ok ? "text-green-600" : "text-red-600"}>
                  {result.ack ?? (result.error ? "ERROR" : "—")}
                </strong>
              </>
            ) : (
              <strong className="text-red-600">ERROR</strong>
            )}
          </span>
        )}
      </div>

      {error && !result && (
        <pre className="mt-4 max-h-96 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 font-mono text-[11px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </pre>
      )}

      {result && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-medium text-neutral-500">Raw XML</h3>
            <pre className="max-h-96 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] dark:border-neutral-800 dark:bg-neutral-950">
              {result.rawXml || result.error || "(no body)"}
            </pre>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-neutral-500">Parsed JSON</h3>
            <pre className="max-h-96 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] dark:border-neutral-800 dark:bg-neutral-950">
              {JSON.stringify(result.parsed ?? result, null, 2)}
            </pre>
          </div>
          {result.errors && result.errors.length > 0 && (
            <div className="md:col-span-2">
              <h3 className="mb-1 text-xs font-medium text-red-600">eBay errors</h3>
              <ul className="space-y-1 text-xs">
                {result.errors.map((e, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-900/40 dark:bg-red-950/30"
                  >
                    <strong>{e.code}</strong> — {e.shortMessage}
                    {e.longMessage ? (
                      <span className="block text-neutral-500">{e.longMessage}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

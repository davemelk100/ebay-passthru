"use client";

import { useState } from "react";
import { DESTRUCTIVE_CALLS, SAMPLE_BODIES } from "@/lib/samples";
import { useRememberedItemId } from "./useRememberedItemId";

const CALLS = Object.keys(SAMPLE_BODIES);
const PLACEHOLDER = "REPLACE_WITH_ITEM_ID";

function substituteItemId(xml: string, itemId: string | null): string {
  if (!itemId) return xml;
  return xml.split(PLACEHOLDER).join(itemId);
}

function extractItemIdFromResponse(parsed: unknown): string | null {
  const root = parsed as Record<string, unknown> | null;
  if (!root) return null;
  for (const key of Object.keys(root)) {
    if (!key.endsWith("Response")) continue;
    const resp = root[key] as Record<string, unknown> | undefined;
    const id = resp?.ItemID;
    if (id !== undefined && id !== null && String(id).length > 0) return String(id);
  }
  return null;
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [rememberedItemId, setRememberedItemId] = useRememberedItemId();

  function pickCall(name: string) {
    setCallName(name);
    let body = substituteItemId(SAMPLE_BODIES[name] ?? "", rememberedItemId);
    if (name === "AddItem") {
      // Inject a unique stamp so each click produces a different title and
      // avoids eBay's "Duplicate Listing" policy (error 21919067).
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      body = body.replace("[SANDBOX]", `[SANDBOX ${stamp}]`);
    }
    setXml(body);
    setResult(null);
  }

  async function send() {
    const isDestructive = DESTRUCTIVE_CALLS.has(callName);
    const allowProduction = env === "production" && isDestructive;

    if (allowProduction) {
      const ok = window.confirm(
        `⚠️ You're on PRODUCTION.\n\n${callName} mutates real seller data on eBay.\nProceed?`,
      );
      if (!ok) return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ebay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callName,
          xml,
          ...(allowProduction ? { allowProduction: true } : {}),
        }),
      });
      const data = (await res.json()) as ApiResult;
      setResult(data);

      if (data.ok && callName === "AddItem") {
        const newId = extractItemIdFromResponse(data.parsed);
        if (newId) setRememberedItemId(newId);
      } else if (data.ok && callName === "EndItem" && rememberedItemId) {
        setRememberedItemId(null);
      }
    } catch (e) {
      setResult({
        ok: false,
        status: 0,
        errors: [],
        rawXml: "",
        parsed: null,
        endpoint: "",
        durationMs: 0,
        error: (e as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Trading API passthrough</h2>
        <span className="text-xs text-neutral-500">XML in → XML out</span>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {CALLS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pickCall(c)}
            className={`rounded-full border px-3 py-1 text-xs ${
              callName === c
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-neutral-300 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            }`}
          >
            {c}
          </button>
        ))}
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
        {result && (
          <span className="text-xs text-neutral-500">
            HTTP {result.status} · {result.durationMs}ms · Ack:{" "}
            <strong className={result.ok ? "text-green-600" : "text-red-600"}>
              {result.ack ?? (result.error ? "ERROR" : "—")}
            </strong>
          </span>
        )}
      </div>

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

"use client";

import { useApiCall } from "./useApiCall";

interface StepReport {
  step: "Create" | "Read" | "Update" | "Delete";
  callName: string;
  pass: boolean;
  ack?: string;
  errors: { code?: string; shortMessage?: string; longMessage?: string }[];
  durationMs: number;
  itemId?: string;
  note?: string;
}

interface Summary {
  env?: string;
  overallPass?: boolean;
  itemId?: string;
  steps?: StepReport[];
  error?: string;
  missing?: string[];
}

export default function CrudCheck() {
  const { data: summary, error, loading, run: runApi } = useApiCall<Summary>();

  async function run() {
    if (
      !window.confirm(
        "This will Create → Read → Update → Delete a test listing via Trading API. Sandbox only — production is blocked. Continue?",
      )
    ) {
      return;
    }
    await runApi("/api/crud-check");
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-3">
        <h2 className="text-lg font-semibold">CRUD check</h2>
        <p className="text-xs text-neutral-500">
          Runs <code>AddItem</code> → <code>GetItem</code> → <code>ReviseItem</code> →{" "}
          <code>EndItem</code> and reports pass/fail per step. Sandbox only — the server hard-blocks this in production.
        </p>
      </header>

      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Running…" : "Run CRUD check"}
        </button>
      </div>

      {(error || summary?.error) && (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30">
          {error ?? summary?.error}
          {summary?.missing && summary.missing.length > 0
            ? ` (missing: ${summary.missing.join(", ")})`
            : ""}
        </p>
      )}

      {summary?.steps && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">
            Env: <strong>{summary.env}</strong> · Overall:{" "}
            <strong className={summary.overallPass ? "text-green-600" : "text-red-600"}>
              {summary.overallPass ? "PASS" : "FAIL"}
            </strong>
            {summary.itemId ? <> · ItemID: <code>{summary.itemId}</code></> : null}
          </p>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">Step</th>
                <th className="px-2 py-1">Call</th>
                <th className="px-2 py-1">Result</th>
                <th className="px-2 py-1">Ack</th>
                <th className="px-2 py-1">ms</th>
                <th className="px-2 py-1">Notes / errors</th>
              </tr>
            </thead>
            <tbody>
              {summary.steps.map((s) => (
                <tr key={s.step} className="border-t border-neutral-100 align-top dark:border-neutral-800">
                  <td className="px-2 py-1 font-medium">{s.step}</td>
                  <td className="px-2 py-1 font-mono text-xs">{s.callName}</td>
                  <td className="px-2 py-1">
                    <span className={s.pass ? "text-green-600" : "text-red-600"}>
                      {s.pass ? "PASS" : "FAIL"}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-xs">{s.ack ?? "—"}</td>
                  <td className="px-2 py-1 text-xs">{s.durationMs}</td>
                  <td className="px-2 py-1 text-xs">
                    {s.note ? <div>{s.note}</div> : null}
                    {s.errors.map((e, i) => (
                      <div key={i} className="text-red-600">
                        <strong>{e.code}</strong> {e.shortMessage}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

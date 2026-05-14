"use client";

import type { ApplyResponse } from "@/lib/types";

interface Props {
  data: ApplyResponse | null;
  error: string | null;
}

export function ApplyResult({ data, error }: Props) {
  if (!data && !error) return null;
  const errorMessage = error ?? data?.error;
  return (
    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
      {errorMessage ? (
        <p className="text-red-600">
          {errorMessage}
          {data?.hint && <span className="block text-neutral-500">{data.hint}</span>}
        </p>
      ) : data ? (
        <>
          <div className="mb-1 text-neutral-500">
            Applied:{" "}
            <strong className="text-green-700 dark:text-green-400">{data.appliedCount}</strong>
            {data.failedCount ? (
              <>
                {" "}
                · Failed:{" "}
                <strong className="text-red-700 dark:text-red-400">{data.failedCount}</strong>
              </>
            ) : null}{" "}
            · {data.durationMs}ms
          </div>
          {data.results &&
            data.results
              .filter((r) => !r.ok)
              .map((r) => (
                <div key={r.bestOfferId} className="font-mono text-[11px] text-red-600">
                  {r.bestOfferId} → {r.action} failed:{" "}
                  {r.errors.map((e) => e.shortMessage).filter(Boolean).join("; ")}
                </div>
              ))}
        </>
      ) : null}
    </div>
  );
}

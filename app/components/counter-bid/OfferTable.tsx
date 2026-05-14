"use client";

import type { Dispatch, SetStateAction } from "react";
import type { DecisionView, PreviewRow } from "@/lib/types";

export type ActionType = DecisionView["action"];

export interface Override {
  action: ActionType;
  counterPrice?: number;
  counterQuantity?: number;
  message?: string;
}

interface Props {
  results: PreviewRow[];
  overrides: Record<string, Override>;
  setOverrides: Dispatch<SetStateAction<Record<string, Override>>>;
}

export function OfferTable({ results, overrides, setOverrides }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-2 py-1">Buyer</th>
            <th className="px-2 py-1">Offer</th>
            <th className="px-2 py-1">Ratio</th>
            <th className="px-2 py-1">Grade</th>
            <th className="px-2 py-1">Matched rule</th>
            <th className="px-2 py-1">Action</th>
            <th className="px-2 py-1">Counter $</th>
            <th className="px-2 py-1">Message</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const ov = overrides[r.bestOfferId];
            const action = ov?.action ?? r.decision.action;
            const ratio = r.listingPrice > 0 ? (r.offerPrice / r.listingPrice).toFixed(2) : "—";
            return (
              <tr key={r.bestOfferId} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-2 py-1 font-mono text-xs">{r.buyerUserId ?? "—"}</td>
                <td className="px-2 py-1">${r.offerPrice}</td>
                <td className="px-2 py-1">{ratio}</td>
                <td className="px-2 py-1 text-xs">
                  {r.grade && (r.grade.score ?? 0) > 0 ? (
                    <span
                      className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                      title={r.grade.raw}
                    >
                      {r.grade.company || "?"} {r.grade.score}
                    </span>
                  ) : (
                    <span className="text-neutral-400">raw</span>
                  )}
                </td>
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
  );
}

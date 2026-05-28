import { NextResponse } from "next/server";
import { callTradingApi } from "@/lib/ebay";
import { requireEbayConfig } from "@/lib/api-guards";
import type { ApplyDecisionResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Decisions the UI sends back after the user reviews the preview.
// counter requires counterPrice + counterQuantity; accept/decline take an optional message.
interface DecisionEnvelope {
  itemId: string;
  bestOfferId: string;
  action: "accept" | "decline" | "counter";
  message?: string;
  counterPrice?: number;
  counterQuantity?: number;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    decisions?: DecisionEnvelope[];
  };

  if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty `decisions` array." }, { status: 400 });
  }

  const guard = requireEbayConfig({ okFlag: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;

  const started = Date.now();
  const results: ApplyDecisionResult[] = [];

  for (const d of body.decisions) {
    if (!d.itemId || !d.bestOfferId || !d.action) {
      results.push({
        itemId: d.itemId ?? "",
        bestOfferId: d.bestOfferId ?? "",
        action: d.action ?? "?",
        ok: false,
        errors: [{ shortMessage: "Missing itemId / bestOfferId / action." }],
      });
      continue;
    }

    const actionTag =
      d.action === "accept" ? "Accept" : d.action === "decline" ? "Decline" : "Counter";

    let xml = `<ItemID>${d.itemId}</ItemID>` + `<BestOfferID>${d.bestOfferId}</BestOfferID>` + `<Action>${actionTag}</Action>`;
    if (d.action === "counter") {
      if (typeof d.counterPrice !== "number" || d.counterPrice <= 0) {
        results.push({
          itemId: d.itemId,
          bestOfferId: d.bestOfferId,
          action: d.action,
          ok: false,
          errors: [{ shortMessage: "counter requires a positive counterPrice." }],
        });
        continue;
      }
      const qty = d.counterQuantity ?? 1;
      xml += `<CounterOfferPrice currencyID="USD">${d.counterPrice}</CounterOfferPrice>`;
      xml += `<CounterOfferQuantity>${qty}</CounterOfferQuantity>`;
    }
    if (d.message) {
      xml += `<SellerResponse>${escapeXml(d.message)}</SellerResponse>`;
    }

    const r = await callTradingApi("RespondToBestOffer", xml, cfg);
    results.push({
      itemId: d.itemId,
      bestOfferId: d.bestOfferId,
      action: d.action,
      ok: r.ok,
      ack: r.ack,
      errors: r.errors,
    });
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: okCount === results.length,
    appliedCount: okCount,
    failedCount: results.length - okCount,
    durationMs: Date.now() - started,
    env: cfg.env,
    results,
  });
}

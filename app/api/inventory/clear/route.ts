import { NextResponse } from "next/server";
import { callTradingApi } from "@/lib/ebay";
import { blockIfProduction, requireEbayConfig } from "@/lib/api-guards";
import type { ClearItemResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    allowProduction?: boolean;
  };
  const allowProduction = body.allowProduction === true;

  const guard = requireEbayConfig({ okFlag: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;

  const blocked = blockIfProduction(cfg, {
    blocked: true,
    allowProduction,
    error: "Clear inventory is blocked on production without explicit opt-in.",
    hint: "Re-send with allowProduction:true — this ends every active listing on the seller account.",
    okFlag: true,
  });
  if (blocked) return blocked;

  const started = Date.now();

  // Collect every active ItemID by paging through GetMyeBaySelling.
  const itemIds: string[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= 500; page++) {
    const xml = `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`;
    const result = await callTradingApi("GetMyeBaySelling", xml, cfg);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to enumerate active listings.",
          errors: result.errors,
          durationMs: Date.now() - started,
        },
        { status: 502 },
      );
    }
    const parsed = result.parsed as Record<string, unknown> | null;
    const resp = parsed?.GetMyeBaySellingResponse as Record<string, unknown> | undefined;
    const active = resp?.ActiveList as Record<string, unknown> | undefined;
    const itemArray = (active?.ItemArray as Record<string, unknown> | undefined)?.Item;
    const rawItems = itemArray
      ? (Array.isArray(itemArray) ? itemArray : [itemArray])
      : [];
    for (const it of rawItems) {
      const id = (it as { ItemID?: string | number }).ItemID;
      if (id !== undefined && id !== null) itemIds.push(String(id));
    }
    const pagination = active?.PaginationResult as Record<string, unknown> | undefined;
    totalPages = Number(pagination?.TotalNumberOfPages ?? 1);
  }

  if (itemIds.length === 0) {
    return NextResponse.json({
      ok: true,
      foundCount: 0,
      endedCount: 0,
      failedCount: 0,
      durationMs: Date.now() - started,
      results: [],
      env: cfg.env,
    });
  }

  // End each active listing.
  const results: ClearItemResult[] = [];
  for (const id of itemIds) {
    const endXml = `<ItemID>${id}</ItemID><EndingReason>NotAvailable</EndingReason>`;
    const r = await callTradingApi("EndItem", endXml, cfg);
    results.push({
      itemId: id,
      ended: r.ok,
      ack: r.ack,
      errors: r.errors,
    });
  }

  const endedCount = results.filter((r) => r.ended).length;

  return NextResponse.json({
    ok: endedCount === itemIds.length,
    foundCount: itemIds.length,
    endedCount,
    failedCount: itemIds.length - endedCount,
    durationMs: Date.now() - started,
    results,
    env: cfg.env,
  });
}

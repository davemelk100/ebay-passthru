import { NextResponse } from "next/server";
import { callTradingApi } from "@/lib/ebay";
import { blockIfProduction, requireEbayConfig } from "@/lib/api-guards";
import { asArray, extractArray, getPath } from "@/lib/ebay-xml";
import {
  evaluateOffer,
  extractGradeScore,
  loadRules,
  normalizeGrader,
  type Decision,
  type OfferContext,
} from "@/lib/counter-bid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RawBestOffer {
  BestOfferID?: string;
  Status?: string;
  Buyer?: { UserID?: string };
  Price?: { "#text"?: string | number; "@_currencyID"?: string } | string | number;
  Quantity?: string | number;
}

interface RawItem {
  ItemID?: string | number;
  Title?: string;
  StartPrice?: { "#text"?: string | number; "@_currencyID"?: string } | string | number;
  BuyItNowPrice?: { "#text"?: string | number; "@_currencyID"?: string } | string | number;
  ItemSpecifics?: {
    NameValueList?:
      | { Name?: string; Value?: string | string[] }
      | { Name?: string; Value?: string | string[] }[];
  };
}

interface ExtractedGrade {
  company: string;
  score: number;
  raw: string;
}

function extractGradeFromItem(item: RawItem | undefined): ExtractedGrade | undefined {
  if (!item?.ItemSpecifics) return undefined;
  const list = asArray<{ Name?: string; Value?: string | string[] }>(
    item.ItemSpecifics.NameValueList,
  );
  let gradeStr = "";
  let graderStr = "";
  for (const entry of list) {
    const name = String(entry.Name ?? "").toLowerCase();
    const val = asArray<string>(entry.Value).map(String).join(" ").trim();
    if (!val) continue;
    if (name === "grade" || name === "grading" || name === "card grade") {
      if (!gradeStr) gradeStr = val;
    } else if (
      name === "professional grader" ||
      name === "grading service" ||
      name === "grading company"
    ) {
      if (!graderStr) graderStr = val;
    } else if (name === "certification" || name === "certification number") {
      // sometimes contains "PSA 10" combined
      if (!gradeStr) gradeStr = val;
    }
  }
  const raw = [graderStr, gradeStr].filter(Boolean).join(" ").trim();
  if (!raw) return undefined;
  const score = extractGradeScore(gradeStr || raw);
  const company = normalizeGrader(graderStr || gradeStr || raw);
  if (!Number.isFinite(score) && !company) return undefined;
  return {
    company,
    score: Number.isFinite(score) ? score : 0,
    raw,
  };
}

function numFromPrice(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number.parseFloat(v) || 0;
  if (typeof v === "object") {
    const t = (v as { "#text"?: unknown })["#text"];
    return typeof t === "number" ? t : Number.parseFloat(String(t ?? "0")) || 0;
  }
  return 0;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    itemId?: string;
    comps?: number[];
    // For unit-testing the engine without hitting Trading API.
    offers?: OfferContext[];
  };

  const guard = requireEbayConfig({ okFlag: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;

  // Live previews leak pending buyer offer prices + buyer UserIDs. Hard-block
  // in production. Synthetic mode is safe but the route blocks before reading
  // the body shape, so the whole route is off in prod.
  const blocked = blockIfProduction(cfg, {
    blocked: true,
    error: "Counter-bid preview is disabled in production — exposes pending buyer offers.",
    okFlag: true,
  });
  if (blocked) return blocked;

  const ruleFile = await loadRules();
  const comps = Array.isArray(body.comps) ? body.comps.filter((n) => typeof n === "number") : [];

  // Synthetic mode: caller provides offers directly. Lets you preview rules without live offers.
  if (body.offers && Array.isArray(body.offers)) {
    const results = body.offers.map((ctx) => ({
      ...ctx,
      comps: ctx.comps ?? comps,
      decision: evaluateOffer(ruleFile.rules, { ...ctx, comps: ctx.comps ?? comps }),
    }));
    return NextResponse.json({
      ok: true,
      mode: "synthetic",
      ruleCount: ruleFile.rules.length,
      results,
    });
  }

  if (!body.itemId) {
    return NextResponse.json(
      { error: "Provide either `itemId` (to fetch offers) or `offers` (synthetic mode)." },
      { status: 400 },
    );
  }

  // Pull pending offers + listing price.
  const offersResult = await callTradingApi(
    "GetBestOffers",
    `<ItemID>${body.itemId}</ItemID><BestOfferStatus>Active</BestOfferStatus><DetailLevel>ReturnAll</DetailLevel>`,
    cfg,
  );
  const itemResult = await callTradingApi(
    "GetItem",
    `<ItemID>${body.itemId}</ItemID><DetailLevel>ReturnAll</DetailLevel>`,
    cfg,
  );

  const rawOffers = extractArray<RawBestOffer>(
    offersResult.parsed,
    "GetBestOffersResponse",
    "BestOfferArray",
    "BestOffer",
  );

  const rawItem = getPath(itemResult.parsed, ["GetItemResponse", "Item"]) as RawItem | undefined;
  const listingPrice = rawItem ? numFromPrice(rawItem.StartPrice ?? rawItem.BuyItNowPrice) : 0;
  const grade = extractGradeFromItem(rawItem);

  const results: Array<OfferContext & { decision: Decision }> = rawOffers.map((o) => {
    const ctx: OfferContext = {
      itemId: String(body.itemId),
      bestOfferId: String(o.BestOfferID ?? ""),
      buyerUserId: o.Buyer?.UserID,
      offerPrice: numFromPrice(o.Price),
      listingPrice,
      quantity: Number(o.Quantity ?? 1),
      comps,
      grade,
    };
    return { ...ctx, decision: evaluateOffer(ruleFile.rules, ctx) };
  });

  return NextResponse.json({
    ok: true,
    mode: "live",
    itemId: body.itemId,
    title: rawItem?.Title,
    listingPrice,
    offerCount: results.length,
    ruleCount: ruleFile.rules.length,
    rulesPath: "lib/counter-bid-rules.json",
    compsCount: comps.length,
    results,
    upstream: {
      getBestOffers: { ok: offersResult.ok, ack: offersResult.ack, errors: offersResult.errors },
      getItem: { ok: itemResult.ok, ack: itemResult.ack, errors: itemResult.errors },
    },
  });
}

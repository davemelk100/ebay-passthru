import { NextResponse } from "next/server";
import { callTradingApi } from "@/lib/ebay";
import { requireEbayConfig } from "@/lib/api-guards";
import { extractArray, getResponse } from "@/lib/ebay-xml";
import type { InventoryItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RawItem {
  ItemID?: string | number;
  Title?: string;
  SKU?: string;
  Quantity?: string | number;
  ListingType?: string;
  TimeLeft?: string;
  SellingStatus?: {
    CurrentPrice?: { "#text"?: string | number; "@_currencyID"?: string } | string | number;
    QuantitySold?: string | number;
    ListingStatus?: string;
  };
  ListingDetails?: { ViewItemURL?: string; StartTime?: string; EndTime?: string };
  PrimaryCategory?: { CategoryID?: string | number; CategoryName?: string };
  PictureDetails?: { PictureURL?: string | string[]; GalleryURL?: string };
}

// Fetches a single page of active listings via GetSellerList. The caller
// drives pagination (page 1 first, then "load more" for page N+1) so a
// fresh load only costs one Trading API round-trip instead of dozens.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    entriesPerPage?: number;
    pageNumber?: number;
    daysAhead?: number;
    daysBack?: number;
    includeEnded?: boolean;
  };
  const entriesPerPage = Math.min(200, Math.max(1, body.entriesPerPage ?? 10));
  const pageNumber = Math.max(1, body.pageNumber ?? 1);
  const includeEnded = body.includeEnded === true;
  // eBay caps EndTimeFrom..EndTimeTo at ~120 days. Split when including ended.
  let daysAhead = Math.min(119, Math.max(1, body.daysAhead ?? (includeEnded ? 89 : 119)));
  let daysBack = Math.min(119, Math.max(0, body.daysBack ?? (includeEnded ? 30 : 0)));
  if (daysAhead + daysBack > 119) {
    daysBack = Math.max(0, 119 - daysAhead);
  }

  const guard = requireEbayConfig({ okFlag: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;

  const now = new Date();
  const endFrom = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const endTo = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  const started = Date.now();
  const xml =
    `<EndTimeFrom>${endFrom}</EndTimeFrom>` +
    `<EndTimeTo>${endTo}</EndTimeTo>` +
    `<DetailLevel>ReturnAll</DetailLevel>` +
    `<GranularityLevel>Fine</GranularityLevel>` +
    `<Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination>`;

  let result;
  try {
    result = await callTradingApi("GetSellerList", xml, cfg);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        fetched: 0,
        pageNumber,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        durationMs: Date.now() - started,
      },
      { status: 502 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        fetched: 0,
        pageNumber,
        errors: result.errors,
        durationMs: Date.now() - started,
      },
      { status: 502 },
    );
  }

  const rawItems = extractArray<RawItem>(
    result.parsed,
    "GetSellerListResponse",
    "ItemArray",
    "Item",
  );
  const items: InventoryItem[] = [];
  for (const raw of rawItems) {
    const status = raw.SellingStatus?.ListingStatus;
    if (!includeEnded && status && status !== "Active") continue;
    items.push(normalizeItem(raw));
  }

  const resp = getResponse(result.parsed, "GetSellerListResponse");
  const pagination = resp?.PaginationResult as Record<string, unknown> | undefined;
  const totalEntries = Number(pagination?.TotalNumberOfEntries ?? items.length);
  const totalPages = Number(pagination?.TotalNumberOfPages ?? 1);

  return NextResponse.json({
    ok: true,
    fetched: items.length,
    totalEntries,
    pageNumber,
    totalPages,
    hasMore: pageNumber < totalPages,
    durationMs: Date.now() - started,
    items,
    includeEnded,
    window: { endTimeFrom: endFrom, endTimeTo: endTo, daysAhead, daysBack },
  });
}

function normalizeItem(raw: RawItem): InventoryItem {
  const cp = raw.SellingStatus?.CurrentPrice;
  let price = "";
  let currency = "";
  if (typeof cp === "object" && cp !== null) {
    price = String((cp as { "#text"?: unknown })["#text"] ?? "");
    currency = String((cp as { "@_currencyID"?: unknown })["@_currencyID"] ?? "");
  } else if (cp !== undefined) {
    price = String(cp);
  }

  const pic = raw.PictureDetails?.PictureURL;
  const pictureUrls = pic ? (Array.isArray(pic) ? pic : [pic]) : [];

  return {
    itemId: String(raw.ItemID ?? ""),
    title: String(raw.Title ?? ""),
    sku: String(raw.SKU ?? ""),
    quantity: Number(raw.Quantity ?? 0),
    quantitySold: Number(raw.SellingStatus?.QuantitySold ?? 0),
    price,
    currency,
    listingType: String(raw.ListingType ?? ""),
    listingStatus: String(raw.SellingStatus?.ListingStatus ?? ""),
    timeLeft: String(raw.TimeLeft ?? ""),
    viewItemUrl: String(raw.ListingDetails?.ViewItemURL ?? ""),
    startTime: String(raw.ListingDetails?.StartTime ?? ""),
    endTime: String(raw.ListingDetails?.EndTime ?? ""),
    primaryCategoryId: String(raw.PrimaryCategory?.CategoryID ?? ""),
    primaryCategoryName: String(raw.PrimaryCategory?.CategoryName ?? ""),
    pictureUrls,
  };
}

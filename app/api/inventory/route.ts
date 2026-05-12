import { NextResponse } from "next/server";
import { callTradingApi, configIssues, readConfig } from "@/lib/ebay";

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

interface NormalizedItem {
  itemId: string;
  title: string;
  sku: string;
  quantity: number;
  quantitySold: number;
  price: string;
  currency: string;
  listingType: string;
  timeLeft: string;
  viewItemUrl: string;
  startTime: string;
  endTime: string;
  primaryCategoryId: string;
  primaryCategoryName: string;
  pictureUrls: string[];
}

// Pulls every currently-active listing via GetSellerList using a forward
// EndTime window. Captures all active items (including long-running GTC
// listings) regardless of when they were originally created, because eBay
// keeps GTC EndTime rolling within the next ~30 days.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    entriesPerPage?: number;
    maxPages?: number;
    daysAhead?: number;
  };
  const entriesPerPage = Math.min(200, Math.max(1, body.entriesPerPage ?? 100));
  const maxPages = Math.min(500, Math.max(1, body.maxPages ?? 50));
  const daysAhead = Math.min(119, Math.max(1, body.daysAhead ?? 119));

  const cfg = readConfig();
  const missing = configIssues(cfg);
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: "Missing eBay credentials.", missing },
      { status: 412 },
    );
  }

  const now = new Date();
  const endFrom = now.toISOString();
  const endTo = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  const started = Date.now();
  const items: NormalizedItem[] = [];
  let totalEntries = 0;
  let totalPages = 1;
  let lastPageFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const xml =
      `<EndTimeFrom>${endFrom}</EndTimeFrom>` +
      `<EndTimeTo>${endTo}</EndTimeTo>` +
      `<DetailLevel>ReturnAll</DetailLevel>` +
      `<GranularityLevel>Fine</GranularityLevel>` +
      `<Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>`;
    const result = await callTradingApi("GetSellerList", xml, cfg);
    lastPageFetched = page;

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          fetched: items.length,
          pagesFetched: page - 1,
          stoppedOnPage: page,
          errors: result.errors,
          durationMs: Date.now() - started,
        },
        { status: 502 },
      );
    }

    const parsed = result.parsed as Record<string, unknown> | null;
    const resp = parsed?.GetSellerListResponse as Record<string, unknown> | undefined;
    const itemArray = (resp?.ItemArray as Record<string, unknown> | undefined)?.Item;
    const rawItems = itemArray
      ? ((Array.isArray(itemArray) ? itemArray : [itemArray]) as RawItem[])
      : [];

    // GetSellerList returns ended/sold items too — keep only Active.
    for (const raw of rawItems) {
      const status = raw.SellingStatus?.ListingStatus;
      if (status && status !== "Active") continue;
      items.push(normalizeItem(raw));
    }

    const pagination = resp?.PaginationResult as Record<string, unknown> | undefined;
    totalEntries = Number(pagination?.TotalNumberOfEntries ?? items.length);
    totalPages = Number(pagination?.TotalNumberOfPages ?? 1);
    if (page >= totalPages) break;
  }

  return NextResponse.json({
    ok: true,
    fetched: items.length,
    totalEntries,
    pagesFetched: lastPageFetched,
    totalPages,
    truncated: lastPageFetched < totalPages,
    durationMs: Date.now() - started,
    items,
    window: { endTimeFrom: endFrom, endTimeTo: endTo, daysAhead },
  });
}

function normalizeItem(raw: RawItem): NormalizedItem {
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
    timeLeft: String(raw.TimeLeft ?? ""),
    viewItemUrl: String(raw.ListingDetails?.ViewItemURL ?? ""),
    startTime: String(raw.ListingDetails?.StartTime ?? ""),
    endTime: String(raw.ListingDetails?.EndTime ?? ""),
    primaryCategoryId: String(raw.PrimaryCategory?.CategoryID ?? ""),
    primaryCategoryName: String(raw.PrimaryCategory?.CategoryName ?? ""),
    pictureUrls,
  };
}

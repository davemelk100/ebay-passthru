import { NextResponse } from "next/server";
import { callTradingApi } from "@/lib/ebay";
import { requireEbayConfig } from "@/lib/api-guards";
import { extractArray } from "@/lib/ebay-xml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Per-item GetBestOffers calls run sequentially; the default 60s window
// usually suffices, but bump to 120s in case a seller has many items with
// active offers.
export const maxDuration = 120;

interface RawBestOffer {
  BestOfferID?: string;
  Status?: string;
  Buyer?: { UserID?: string };
  Price?: { "#text"?: string | number; "@_currencyID"?: string } | string | number;
  Quantity?: string | number;
  ExpirationTime?: string;
  Message?: string;
}

interface RawItemWithOffers {
  ItemID?: string | number;
  Title?: string;
  ListingDetails?: { ViewItemURL?: string };
  PictureDetails?: { PictureURL?: string | string[]; GalleryURL?: string };
}

function priceNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number.parseFloat(v) || 0;
  if (typeof v === "object" && v !== null) {
    const t = (v as { "#text"?: unknown })["#text"];
    return priceNumber(t);
  }
  return 0;
}

function priceCurrency(v: unknown): string {
  if (typeof v === "object" && v !== null) {
    return String((v as Record<string, unknown>)["@_currencyID"] ?? "");
  }
  return "";
}

export async function POST() {
  const guard = requireEbayConfig({ okFlag: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;
  const started = Date.now();

  // Step 1 — enumerate items that have at least one active best offer.
  const sellingXml =
    `<BestOfferList>` +
    `<Include>true</Include>` +
    `<Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>` +
    `</BestOfferList>` +
    `<DetailLevel>ReturnAll</DetailLevel>`;
  const selling = await callTradingApi("GetMyeBaySelling", sellingXml, cfg);
  if (!selling.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to enumerate items with active offers.",
        errors: selling.errors,
        durationMs: Date.now() - started,
      },
      { status: 502 },
    );
  }

  const itemsWithOffers = extractArray<RawItemWithOffers>(
    selling.parsed,
    "GetMyeBaySellingResponse",
    "BestOfferList",
    "ItemArray",
    "Item",
  );

  // Step 2 — expand each item to individual offers.
  const offers: Array<{
    itemId: string;
    title: string;
    viewItemUrl: string;
    pictureUrl: string;
    bestOfferId: string;
    status: string;
    offerPrice: number;
    currency: string;
    quantity: number;
    buyerUserId: string;
    expirationTime: string;
    message: string;
  }> = [];

  for (const item of itemsWithOffers) {
    const itemId = String(item.ItemID ?? "");
    if (!itemId) continue;

    const pic = item.PictureDetails?.PictureURL;
    const pictureUrl = pic
      ? Array.isArray(pic)
        ? pic[0] ?? ""
        : pic
      : String(item.PictureDetails?.GalleryURL ?? "");

    const r = await callTradingApi(
      "GetBestOffers",
      `<ItemID>${itemId}</ItemID><BestOfferStatus>Active</BestOfferStatus><DetailLevel>ReturnAll</DetailLevel>`,
      cfg,
    );
    if (!r.ok) continue;

    const rawOffers = extractArray<RawBestOffer>(
      r.parsed,
      "GetBestOffersResponse",
      "BestOfferArray",
      "BestOffer",
    );
    for (const raw of rawOffers) {
      offers.push({
        itemId,
        title: String(item.Title ?? ""),
        viewItemUrl: String(item.ListingDetails?.ViewItemURL ?? ""),
        pictureUrl,
        bestOfferId: String(raw.BestOfferID ?? ""),
        status: String(raw.Status ?? ""),
        offerPrice: priceNumber(raw.Price),
        currency: priceCurrency(raw.Price),
        quantity: Number(raw.Quantity ?? 1),
        buyerUserId: String(raw.Buyer?.UserID ?? ""),
        expirationTime: String(raw.ExpirationTime ?? ""),
        message: String(raw.Message ?? ""),
      });
    }
  }

  // Newest expiration first so the most urgent offers float to the top.
  offers.sort((a, b) => (a.expirationTime < b.expirationTime ? -1 : 1));

  return NextResponse.json({
    ok: true,
    itemsWithOffers: itemsWithOffers.length,
    offerCount: offers.length,
    offers,
    durationMs: Date.now() - started,
    fetchedAt: new Date().toISOString(),
    env: cfg.env,
  });
}

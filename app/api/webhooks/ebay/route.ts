import "server-only";
import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { callTradingApi, readConfig } from "@/lib/ebay";
import { asArray, extractArray } from "@/lib/ebay-xml";
import { notificationStore } from "@/lib/notifications-store";
import type { NotificationEvent } from "@/lib/types";

const BID_EVENT_NAMES = new Set([
  "BestOffer",
  "BestOfferPlaced",
  "BestOfferDeclined",
  "BidPlaced",
  "BidReceived",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
  removeNSPrefix: true,
});

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

// eBay's Trading-API platform notifications include a NotificationSignature
// computed as MD5(Timestamp + DevID + AppID + CertID), base64-encoded.
function verifyNotificationSignature(
  timestamp: string,
  signature: string,
  devId: string,
  appId: string,
  certId: string,
): boolean {
  if (!timestamp || !signature) return false;
  const expected = createHash("md5")
    .update(timestamp + devId + appId + certId)
    .digest("base64");
  return expected === signature;
}

// eBay POSTs the SOAP-wrapped notification XML to this URL. We accept any
// well-formed notification, verify the signature, normalize the offer
// fields, and append to the store. Always respond 200 so eBay doesn't
// hammer us with retries on parse hiccups — we log instead.
export async function POST(req: Request) {
  const cfg = readConfig();
  const xml = await req.text();

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    console.warn("ebay-webhook: XML parse failed", err);
    return NextResponse.json({ ok: true, parsed: false });
  }

  // SOAP envelope: Envelope > Body > <CallNameResponse>
  const envelope = (parsed.Envelope ?? parsed) as Record<string, unknown>;
  const body = (envelope.Body ?? envelope) as Record<string, unknown>;

  // Find the *Response root inside the body.
  let responseKey: string | undefined;
  let response: Record<string, unknown> | undefined;
  for (const key of Object.keys(body)) {
    if (key.endsWith("Response")) {
      responseKey = key;
      response = body[key] as Record<string, unknown>;
      break;
    }
  }
  if (!responseKey || !response) {
    console.warn("ebay-webhook: no *Response root", Object.keys(body));
    return NextResponse.json({ ok: true, recognized: false });
  }

  // NotificationEventName lives at the top of the response.
  const eventName = String(response.NotificationEventName ?? responseKey.replace(/Response$/, ""));
  const timestamp = String(response.Timestamp ?? new Date().toISOString());

  // Signature verification.
  const creds = response.RequesterCredentials as Record<string, unknown> | undefined;
  const signature = String(creds?.NotificationSignature ?? "");
  const signatureValid = verifyNotificationSignature(
    timestamp,
    signature,
    cfg.devId,
    cfg.appId,
    cfg.certId,
  );
  if (!signatureValid) {
    console.warn(
      `ebay-webhook: signature mismatch for ${eventName} (got=${signature.slice(0, 8)}…)`,
    );
  }

  // Normalize offer-flavored events. eBay sometimes places the offer
  // straight under the response root, sometimes under BestOfferArray /
  // BestOffer, sometimes only the Item element is present and the buyer's
  // price requires a follow-up GetBestOffers call.
  type RawBestOffer = {
    BestOfferID?: string;
    Buyer?: { UserID?: string };
    Price?: unknown;
    Quantity?: string | number;
  };
  type RawItem = { ItemID?: string | number; Title?: string };

  function findBestOffer(obj: unknown, depth = 0): RawBestOffer | null {
    if (depth > 6 || !obj || typeof obj !== "object") return null;
    const o = obj as Record<string, unknown>;
    if (o.BestOfferID !== undefined || (o.Price !== undefined && o.Buyer !== undefined)) {
      return o as RawBestOffer;
    }
    for (const v of Object.values(o)) {
      const found = findBestOffer(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const offer = (response.BestOffer ?? findBestOffer(response)) as RawBestOffer | null;
  const item = (response.Item ?? null) as RawItem | null;

  const event: NotificationEvent = {
    id: randomUUID(),
    eventName,
    timestamp,
    itemId: item?.ItemID ? String(item.ItemID) : undefined,
    title: item?.Title ? String(item.Title) : undefined,
    bestOfferId: offer?.BestOfferID ? String(offer.BestOfferID) : undefined,
    offerPrice: offer?.Price !== undefined ? priceNumber(offer.Price) : undefined,
    currency: offer?.Price !== undefined ? priceCurrency(offer.Price) : undefined,
    buyerUserId: offer?.Buyer?.UserID ? String(offer.Buyer.UserID) : undefined,
    quantity: offer?.Quantity !== undefined ? Number(offer.Quantity) : undefined,
    signatureValid,
  };

  // Fallback for bid-style events whose notification XML didn't carry the
  // BestOffer details — pull the live pending offers for that item and pick
  // the matching offer (or the most recent if BestOfferID isn't known).
  if (BID_EVENT_NAMES.has(eventName) && event.itemId && event.offerPrice === undefined) {
    try {
      const r = await callTradingApi(
        "GetBestOffers",
        `<ItemID>${event.itemId}</ItemID><BestOfferStatus>Active</BestOfferStatus><DetailLevel>ReturnAll</DetailLevel>`,
        cfg,
      );
      const offers = extractArray<RawBestOffer>(
        r.parsed,
        "GetBestOffersResponse",
        "BestOfferArray",
        "BestOffer",
      );
      const match =
        offers.find((o) => o.BestOfferID && o.BestOfferID === event.bestOfferId) ??
        offers[offers.length - 1];
      if (match) {
        event.bestOfferId ??= match.BestOfferID ? String(match.BestOfferID) : undefined;
        event.offerPrice = match.Price !== undefined ? priceNumber(match.Price) : event.offerPrice;
        event.currency = match.Price !== undefined ? priceCurrency(match.Price) : event.currency;
        event.buyerUserId = match.Buyer?.UserID
          ? String(asArray(match.Buyer.UserID)[0])
          : event.buyerUserId;
        event.quantity =
          match.Quantity !== undefined ? Number(match.Quantity) : event.quantity;
      }
    } catch (err) {
      console.warn(`ebay-webhook: GetBestOffers fallback failed for ${event.itemId}`, err);
    }
  }

  await notificationStore.push(event);

  return NextResponse.json({ ok: true, eventName, signatureValid });
}

// GET is a liveness probe — eBay doesn't use it, but it's handy for
// verifying the URL is reachable before subscribing.
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/webhooks/ebay" });
}

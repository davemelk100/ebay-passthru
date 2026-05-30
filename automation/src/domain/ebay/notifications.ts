import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

// ─────────────────────────────────────────────────────────────────────────────
// SOAP-aware parser
// ─────────────────────────────────────────────────────────────────────────────
// Different config from the regular Trading API response parser: removeNSPrefix
// strips the `soap:` prefix from <soap:Envelope>/<soap:Body> so we can walk
// the structure with plain key names.

const soapParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
  removeNSPrefix: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedNotification {
  /** NotificationEventName from the body (BestOffer, BidPlaced, ItemSold, …). */
  eventName: string;
  /** ISO 8601 timestamp eBay generated for the event. */
  timestamp: string;
  /** Best-effort: the seller's ItemID if the body included an <Item>. */
  itemId?: string;
  /** Best-effort: the listing title. */
  title?: string;
  /** Set for offer-flavored events. */
  bestOfferId?: string;
  offerPrice?: number;
  currency?: string;
  buyerUserId?: string;
  quantity?: number;
  /** Result of NotificationSignature MD5(timestamp + devId + appId + certId). */
  signatureValid: boolean;
}

export interface NotificationCreds {
  devId: string;
  appId: string;
  certId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────────
// eBay's Trading-API platform notifications include a NotificationSignature
// computed as MD5(Timestamp + DevID + AppID + CertID), base64-encoded. Reject
// at the receiver only if the operator decides to — historically we *log*
// signature failures and keep the event, since legit credentials drift,
// notifications-during-rotation, etc. produce false positives.

export function verifyNotificationSignature(
  timestamp: string,
  signature: string,
  creds: NotificationCreds,
): boolean {
  if (!timestamp || !signature) return false;
  const expected = createHash("md5")
    .update(timestamp + creds.devId + creds.appId + creds.certId)
    .digest("base64");
  return expected === signature;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursive BestOffer finder
// ─────────────────────────────────────────────────────────────────────────────
// Different notification flavors put the buyer offer in different places —
// directly under the response root, nested under BestOfferArray, sometimes
// only at the BestOfferDetails wrapper. Bounded-depth recursive search for
// an object that looks like a BestOffer (has either BestOfferID or both
// Price and Buyer fields).

interface RawBestOffer {
  BestOfferID?: string | number;
  Buyer?: { UserID?: string };
  Price?: unknown;
  Quantity?: string | number;
  [key: string]: unknown;
}

interface RawItem {
  ItemID?: string | number;
  Title?: string;
  [key: string]: unknown;
}

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

function priceNumber(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === "object") {
    const t = (v as { "#text"?: unknown })["#text"];
    return priceNumber(t);
  }
  return undefined;
}

function priceCurrency(v: unknown): string | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const code = (v as Record<string, unknown>)["@_currencyID"];
  return code !== undefined ? String(code) : undefined;
}

function stringOrUndefined(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}

function numberOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse + normalize a raw SOAP body into a ParsedNotification
// ─────────────────────────────────────────────────────────────────────────────

export interface ParseResult {
  /** Set on parse failure or when no recognizable *Response root was found. */
  error?: string;
  notification?: ParsedNotification;
}

export function parseNotificationXml(xml: string, creds: NotificationCreds): ParseResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = soapParser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    return { error: `xml parse failed: ${(err as Error).message}` };
  }

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
    return { error: "no *Response root in SOAP body" };
  }

  const eventName = String(response.NotificationEventName ?? responseKey.replace(/Response$/, ""));
  const timestamp = String(response.Timestamp ?? new Date().toISOString());

  const credsBlock = response.RequesterCredentials as Record<string, unknown> | undefined;
  const signature = String(credsBlock?.NotificationSignature ?? "");
  const signatureValid = verifyNotificationSignature(timestamp, signature, creds);

  const item = (response.Item ?? null) as RawItem | null;
  const offer = (response.BestOffer ?? findBestOffer(response)) as RawBestOffer | null;

  const notification: ParsedNotification = {
    eventName,
    timestamp,
    itemId: item?.ItemID !== undefined ? String(item.ItemID) : undefined,
    title: item?.Title !== undefined ? String(item.Title) : undefined,
    bestOfferId: offer?.BestOfferID !== undefined ? String(offer.BestOfferID) : undefined,
    offerPrice: offer?.Price !== undefined ? priceNumber(offer.Price) : undefined,
    currency: offer?.Price !== undefined ? priceCurrency(offer.Price) : undefined,
    buyerUserId: stringOrUndefined(offer?.Buyer?.UserID),
    quantity: numberOrUndefined(offer?.Quantity),
    signatureValid,
  };

  return { notification };
}

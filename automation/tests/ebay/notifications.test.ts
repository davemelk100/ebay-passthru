import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseNotificationXml,
  verifyNotificationSignature,
  type NotificationCreds,
} from "../../src/domain/ebay/notifications.js";

const CREDS: NotificationCreds = {
  devId: "DEV-XX",
  appId: "APP-YY",
  certId: "CERT-ZZ",
};

function sign(timestamp: string, creds = CREDS): string {
  return createHash("md5")
    .update(timestamp + creds.devId + creds.appId + creds.certId)
    .digest("base64");
}

function bestOfferEnvelope(opts: {
  timestamp?: string;
  signature?: string;
  eventName?: string;
  itemId?: string;
  title?: string;
  bestOfferId?: string;
  price?: string;
  currency?: string;
  buyerUserId?: string;
  quantity?: number;
  /** Wraps the offer in <BestOfferArray><BestOffer>…</BestOffer></BestOfferArray>. */
  nested?: boolean;
  /** Drops the BestOffer element entirely (simulates Item-only notification). */
  omitOffer?: boolean;
}): string {
  const ts = opts.timestamp ?? "2026-05-29T12:00:00.000Z";
  const sig = opts.signature ?? sign(ts);
  const eventName = opts.eventName ?? "BestOffer";
  const itemId = opts.itemId ?? "123456789";
  const title = opts.title ?? "Test Card";
  const bestOfferId = opts.bestOfferId ?? "BO-001";
  const price = opts.price ?? "25.00";
  const currency = opts.currency ?? "USD";
  const buyer = opts.buyerUserId ?? "buyer42";
  const qty = opts.quantity ?? 1;

  const offerXml = opts.omitOffer
    ? ""
    : `<BestOffer>
        <BestOfferID>${bestOfferId}</BestOfferID>
        <Status>Pending</Status>
        <Price currencyID="${currency}">${price}</Price>
        <Quantity>${qty}</Quantity>
        <Buyer><UserID>${buyer}</UserID></Buyer>
      </BestOffer>`;

  const wrapped = opts.nested ? `<BestOfferArray>${offerXml}</BestOfferArray>` : offerXml;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetItemTransactionsResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Timestamp>${ts}</Timestamp>
      <Ack>Success</Ack>
      <NotificationEventName>${eventName}</NotificationEventName>
      <RecipientUserID>test-seller</RecipientUserID>
      <RequesterCredentials>
        <NotificationSignature>${sig}</NotificationSignature>
      </RequesterCredentials>
      <Item>
        <ItemID>${itemId}</ItemID>
        <Title>${title}</Title>
      </Item>
      ${wrapped}
    </GetItemTransactionsResponse>
  </soap:Body>
</soap:Envelope>`;
}

describe("verifyNotificationSignature", () => {
  it("returns true when md5(ts+dev+app+cert) base64 matches", () => {
    const ts = "2026-05-29T12:00:00.000Z";
    expect(verifyNotificationSignature(ts, sign(ts), CREDS)).toBe(true);
  });
  it("returns false on signature mismatch", () => {
    expect(
      verifyNotificationSignature("2026-05-29T12:00:00.000Z", "not-a-real-signature", CREDS),
    ).toBe(false);
  });
  it("returns false when timestamp or signature is empty", () => {
    expect(verifyNotificationSignature("", sign("x"), CREDS)).toBe(false);
    expect(verifyNotificationSignature("2026-05-29T12:00:00.000Z", "", CREDS)).toBe(false);
  });
});

describe("parseNotificationXml", () => {
  it("normalizes a full BestOffer envelope with a valid signature", () => {
    const xml = bestOfferEnvelope({});
    const { notification, error } = parseNotificationXml(xml, CREDS);
    expect(error).toBeUndefined();
    expect(notification).toMatchObject({
      eventName: "BestOffer",
      timestamp: "2026-05-29T12:00:00.000Z",
      itemId: "123456789",
      title: "Test Card",
      bestOfferId: "BO-001",
      offerPrice: 25,
      currency: "USD",
      buyerUserId: "buyer42",
      quantity: 1,
      signatureValid: true,
    });
  });

  it("flags signatureValid=false on signature mismatch (but still returns the parsed event)", () => {
    const xml = bestOfferEnvelope({ signature: "totally-wrong" });
    const { notification } = parseNotificationXml(xml, CREDS);
    expect(notification?.signatureValid).toBe(false);
    expect(notification?.offerPrice).toBe(25);
  });

  it("finds the BestOffer when nested inside BestOfferArray", () => {
    const xml = bestOfferEnvelope({ nested: true, price: "100.50", bestOfferId: "BO-NEST" });
    const { notification } = parseNotificationXml(xml, CREDS);
    expect(notification?.bestOfferId).toBe("BO-NEST");
    expect(notification?.offerPrice).toBe(100.5);
  });

  it("returns the parsed event even when the BestOffer block is missing (Item-only payload)", () => {
    const xml = bestOfferEnvelope({ omitOffer: true });
    const { notification, error } = parseNotificationXml(xml, CREDS);
    expect(error).toBeUndefined();
    expect(notification?.itemId).toBe("123456789");
    expect(notification?.bestOfferId).toBeUndefined();
    expect(notification?.offerPrice).toBeUndefined();
  });

  it("falls back to the response root's name when NotificationEventName is absent", () => {
    const ts = "2026-05-29T12:00:00.000Z";
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Timestamp>${ts}</Timestamp>
      <RequesterCredentials><NotificationSignature>${sign(ts)}</NotificationSignature></RequesterCredentials>
    </GetItemResponse>
  </soap:Body>
</soap:Envelope>`;
    const { notification } = parseNotificationXml(xml, CREDS);
    expect(notification?.eventName).toBe("GetItem");
  });

  it("surfaces an error for malformed XML", () => {
    const { error, notification } = parseNotificationXml("<bad><<not xml", CREDS);
    expect(error).toBeDefined();
    expect(notification).toBeUndefined();
  });

  it("surfaces an error when no *Response root is present", () => {
    const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Something/></soap:Body></soap:Envelope>`;
    const { error, notification } = parseNotificationXml(xml, CREDS);
    expect(error).toMatch(/no \*Response root/);
    expect(notification).toBeUndefined();
  });

  it("defaults the timestamp to now when the body omits it (rare but possible)", () => {
    const xml = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <BestOfferResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <NotificationEventName>BestOffer</NotificationEventName>
    </BestOfferResponse>
  </soap:Body>
</soap:Envelope>`;
    const { notification } = parseNotificationXml(xml, CREDS);
    expect(notification?.timestamp).toBeTruthy();
    // signature won't match a synthetic timestamp; we just care it doesn't throw
    expect(notification?.signatureValid).toBe(false);
  });
});

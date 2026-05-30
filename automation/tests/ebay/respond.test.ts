import { describe, expect, it } from "vitest";
import { buildRespondInnerXml } from "../../src/domain/ebay/respond.js";

describe("buildRespondInnerXml", () => {
  it("builds an Accept body", () => {
    const xml = buildRespondInnerXml({
      itemId: "1",
      bestOfferId: "BO",
      action: "accept",
    });
    expect(xml).toBe("<ItemID>1</ItemID><BestOfferID>BO</BestOfferID><Action>Accept</Action>");
  });

  it("builds a Decline body with a SellerResponse message", () => {
    const xml = buildRespondInnerXml({
      itemId: "1",
      bestOfferId: "BO",
      action: "decline",
      message: "Below my floor",
    });
    expect(xml).toContain("<Action>Decline</Action>");
    expect(xml).toContain("<SellerResponse>Below my floor</SellerResponse>");
  });

  it("XML-escapes the SellerResponse message", () => {
    const xml = buildRespondInnerXml({
      itemId: "1",
      bestOfferId: "BO",
      action: "accept",
      message: "K&R <bag>",
    });
    expect(xml).toContain("<SellerResponse>K&amp;R &lt;bag&gt;</SellerResponse>");
  });

  it("builds a Counter body with price, default qty=1, and currency=USD", () => {
    const xml = buildRespondInnerXml({
      itemId: "1",
      bestOfferId: "BO",
      action: "counter",
      counterPrice: 42.5,
    });
    expect(xml).toContain('<CounterOfferPrice currencyID="USD">42.5</CounterOfferPrice>');
    expect(xml).toContain("<CounterOfferQuantity>1</CounterOfferQuantity>");
  });

  it("respects an explicit counterQuantity and currency override", () => {
    const xml = buildRespondInnerXml({
      itemId: "1",
      bestOfferId: "BO",
      action: "counter",
      counterPrice: 100,
      counterQuantity: 5,
      currency: "GBP",
    });
    expect(xml).toContain('<CounterOfferPrice currencyID="GBP">100</CounterOfferPrice>');
    expect(xml).toContain("<CounterOfferQuantity>5</CounterOfferQuantity>");
  });

  it("rejects a counter without a positive price", () => {
    expect(() =>
      buildRespondInnerXml({ itemId: "1", bestOfferId: "BO", action: "counter" }),
    ).toThrowError(/positive counterPrice/);
    expect(() =>
      buildRespondInnerXml({ itemId: "1", bestOfferId: "BO", action: "counter", counterPrice: 0 }),
    ).toThrowError(/positive counterPrice/);
    expect(() =>
      buildRespondInnerXml({
        itemId: "1",
        bestOfferId: "BO",
        action: "counter",
        counterPrice: Number.NaN,
      }),
    ).toThrowError(/positive counterPrice/);
  });
});

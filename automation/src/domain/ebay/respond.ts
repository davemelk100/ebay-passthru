import type { EbayConfig } from "./config.js";
import { callTradingApi, type EbayCallResult } from "./trading.js";

export type RespondAction = "accept" | "decline" | "counter";

export interface RespondToBestOfferInput {
  itemId: string;
  bestOfferId: string;
  action: RespondAction;
  /** Required when action === "counter"; ignored otherwise. */
  counterPrice?: number;
  /** Defaults to 1 when action === "counter"; ignored otherwise. */
  counterQuantity?: number;
  /** Optional SellerResponse message (shown to the buyer). */
  message?: string;
  /** ISO 4217 code for CounterOfferPrice's currencyID attribute. */
  currency?: string;
}

const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPE[c]!);
}

// Builds the inner XML body for a single RespondToBestOffer call. Exported
// so the pipeline can preview/log the body it's about to send before the
// network call lands.
export function buildRespondInnerXml(input: RespondToBestOfferInput): string {
  const action = input.action === "accept" ? "Accept" : input.action === "decline" ? "Decline" : "Counter";
  const parts: string[] = [
    `<ItemID>${input.itemId}</ItemID>`,
    `<BestOfferID>${input.bestOfferId}</BestOfferID>`,
    `<Action>${action}</Action>`,
  ];
  if (input.action === "counter") {
    if (typeof input.counterPrice !== "number" || !Number.isFinite(input.counterPrice) || input.counterPrice <= 0) {
      throw new Error(`counter requires a positive counterPrice (got ${input.counterPrice})`);
    }
    const currency = input.currency ?? "USD";
    const qty = input.counterQuantity ?? 1;
    parts.push(
      `<CounterOfferPrice currencyID="${currency}">${input.counterPrice}</CounterOfferPrice>`,
    );
    parts.push(`<CounterOfferQuantity>${qty}</CounterOfferQuantity>`);
  }
  if (input.message) {
    parts.push(`<SellerResponse>${escapeXml(input.message)}</SellerResponse>`);
  }
  return parts.join("");
}

// Single-offer wrapper around callTradingApi("RespondToBestOffer", …).
export async function respondToBestOffer(
  input: RespondToBestOfferInput,
  cfg: EbayConfig,
): Promise<EbayCallResult> {
  return callTradingApi("RespondToBestOffer", buildRespondInnerXml(input), cfg);
}

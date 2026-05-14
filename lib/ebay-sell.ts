import "server-only";
import { getAccessToken, type EbayConfig } from "./ebay";
import { curlRequest } from "./curl";

// Modern Sell REST API base URLs.
// All Sell APIs (Inventory, Account, Fulfillment, Marketing, Negotiation, Finances) hang off these.
function sellBase(env: EbayConfig["env"]): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export interface SellCallResult {
  ok: boolean;
  status: number;
  body: unknown;
  rawText: string;
  durationMs: number;
  endpoint: string;
}

export type SellMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export async function callSellApi(
  method: SellMethod,
  path: string,
  body: unknown,
  cfg: EbayConfig,
): Promise<SellCallResult> {
  const url = `${sellBase(cfg.env)}${path.startsWith("/") ? path : `/${path}`}`;
  const accessToken = await getAccessToken(cfg);
  const started = Date.now();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    // Most Sell APIs require this header for marketplace context.
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
  };
  const hasBody = body !== undefined && body !== null && method !== "GET" && method !== "DELETE";
  if (hasBody) headers["Content-Type"] = "application/json";

  const { status, text } = await curlRequest(
    url,
    method,
    headers,
    hasBody ? JSON.stringify(body) : null,
  );

  const durationMs = Date.now() - started;
  let parsed: unknown = text;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as raw text
    }
  } else {
    parsed = null;
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    body: parsed,
    rawText: text,
    durationMs,
    endpoint: url,
  };
}

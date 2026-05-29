import "server-only";
import { NextResponse } from "next/server";
import type { ShopifyCatalogResult, ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worst case: full catalog walk + inventory_items batches. 5 min ceiling.
export const maxDuration = 300;

const ADMIN_API_VERSION = "2024-10";
const CACHE_KEY = "shopify:catalog:v5"; // bumped: admin path w/ cost
const TOKEN_CACHE_KEY = "shopify:admin:token:v2";
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
const TOKEN_REFRESH_SAFETY_SECONDS = 60;
const PAGE_LIMIT = 250;
const INVENTORY_BATCH_SIZE = 100;
// Trim Admin API payload; metafields/images/options bloat each response.
const PRODUCT_FIELDS = "id,title,handle,created_at,vendor,variants";

const UPSTASH_URL = (
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
)?.trim();
const UPSTASH_TOKEN = (
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
)?.trim();

async function upstashGet(key: string): Promise<string | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const json = (await r.json()) as { result: string | null };
  return json.result;
}

async function upstashSetEx(key: string, value: string, ttl: number): Promise<void> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  await fetch(`${UPSTASH_URL}/setex/${encodeURIComponent(key)}/${ttl}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

// Exchange Client ID + Client Secret for a 24h Admin API access token via
// the client_credentials grant. Cached in Upstash; auto-refreshes ≥60s
// before expiry. App must be installed on the shop or the OAuth endpoint
// returns "app_not_installed".
async function getAdminAccessToken(
  domain: string,
): Promise<{ token: string } | { error: string; status: number; hint?: string }> {
  const cached = await upstashGet(TOKEN_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { token: string; expiresAt: number };
      if (parsed.expiresAt > Date.now() + TOKEN_REFRESH_SAFETY_SECONDS * 1000) {
        return { token: parsed.token };
      }
    } catch {
      /* fall through */
    }
  }

  const apiKey = process.env.SHOPIFY_API_KEY?.trim() ?? "";
  const apiSecret = process.env.SHOPIFY_API_SECRET_KEY?.trim() ?? "";
  if (!apiKey || !apiSecret) {
    const missing: string[] = [];
    if (!apiKey) missing.push("SHOPIFY_API_KEY");
    if (!apiSecret) missing.push("SHOPIFY_API_SECRET_KEY");
    return {
      error: `Missing env vars: ${missing.join(", ")}`,
      status: 412,
      hint: "Both come from the Shopify app's Client credentials screen (Client ID + Client Secret).",
    };
  }

  let res: Response;
  try {
    res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: apiKey,
        client_secret: apiSecret,
        grant_type: "client_credentials",
      }),
      cache: "no-store",
    });
  } catch (e) {
    return {
      error: `Token exchange network error: ${(e as Error).message}`,
      status: 502,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      error: `Token exchange HTTP ${res.status}: ${body.slice(0, 200)}`,
      status: 502,
      hint:
        res.status === 400 && body.includes("app_not_installed")
          ? "App must be installed on this shop. Use the Custom Distribution install link from the app's Distribution page."
          : res.status === 401
            ? "Client ID / Client Secret rejected. Confirm both come from the same app."
            : undefined,
    };
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    return { error: "Token exchange returned no access_token", status: 502 };
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 86400;
  const expiresAt = Date.now() + expiresIn * 1000;
  await upstashSetEx(
    TOKEN_CACHE_KEY,
    JSON.stringify({ token: data.access_token, expiresAt }),
    Math.max(expiresIn - TOKEN_REFRESH_SAFETY_SECONDS, 60),
  );
  return { token: data.access_token };
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

interface RawShopifyVariant {
  sku?: string;
  price?: string;
  compare_at_price?: string | null;
  inventory_item_id?: number;
}
interface RawShopifyProduct {
  id?: number;
  title?: string;
  handle?: string;
  created_at?: string;
  vendor?: string;
  variants?: RawShopifyVariant[];
}

export async function GET() {
  const domainRaw = process.env.SHOPIFY_SHOP_DOMAIN?.trim() ?? "";
  const domain = domainRaw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing env var: SHOPIFY_SHOP_DOMAIN",
        hint: "Set SHOPIFY_SHOP_DOMAIN to the *.myshopify.com hostname.",
      } satisfies ShopifyCatalogResult,
      { status: 412 },
    );
  }
  if (!domain.endsWith(".myshopify.com")) {
    return NextResponse.json(
      {
        ok: false,
        error: `SHOPIFY_SHOP_DOMAIN must end in .myshopify.com for Admin API access (got "${domain}").`,
      } satisfies ShopifyCatalogResult,
      { status: 412 },
    );
  }

  const tokenResult = await getAdminAccessToken(domain);
  if ("error" in tokenResult) {
    return NextResponse.json(
      { ok: false, error: tokenResult.error, hint: tokenResult.hint } satisfies ShopifyCatalogResult,
      { status: tokenResult.status },
    );
  }
  const adminToken = tokenResult.token;

  const cached = await upstashGet(CACHE_KEY);
  if (cached) {
    try {
      return NextResponse.json(JSON.parse(cached) as ShopifyCatalogResult);
    } catch {
      /* fall through */
    }
  }

  const map: Record<string, ShopifyProduct> = {};
  // Track inventory_item_id -> sku so we can fold cost back into the map
  // after the bulk inventory_items walk.
  const skuByInventoryItemId = new Map<number, string>();
  const started = Date.now();
  let url: string | null =
    `https://${domain}/admin/api/${ADMIN_API_VERSION}/products.json?limit=${PAGE_LIMIT}&fields=${PRODUCT_FIELDS}`;
  let pageCount = 0;

  while (url) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": adminToken,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `Network error from Admin API on page ${pageCount + 1}: ${(e as Error).message}`,
        } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `Admin API HTTP ${res.status} on page ${pageCount + 1}: ${body.slice(0, 200)}`,
          hint:
            res.status === 401
              ? "Token rejected — scope missing or token expired."
              : res.status === 429
                ? "Rate-limited. Lower call rate or retry after Retry-After."
                : undefined,
        } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }

    const data = (await res.json()) as { products?: RawShopifyProduct[] };
    const products = data.products ?? [];
    for (const p of products) {
      const handle = String(p.handle ?? "");
      const title = String(p.title ?? "");
      const created_at = String(p.created_at ?? "");
      for (const v of p.variants ?? []) {
        const sku = String(v.sku ?? "").trim();
        if (!sku) continue;
        map[sku] = {
          sku,
          handle,
          title,
          created_at,
          price: String(v.price ?? ""),
          compareAtPrice:
            v.compare_at_price != null ? String(v.compare_at_price) : undefined,
        };
        if (typeof v.inventory_item_id === "number") {
          skuByInventoryItemId.set(v.inventory_item_id, sku);
        }
      }
    }
    pageCount += 1;
    url = parseNextLink(res.headers.get("link"));
    if (pageCount > 50) break;
  }

  // ---- Fold COGS via inventory_items.json -----------------------------
  // Cost lives on InventoryItem, not on Variant. Batch fetch by ID, max 100
  // per call. Failures here don't tank the whole catalog — sticker still
  // surfaces; cost just stays undefined for failed batches.
  const inventoryItemIds = Array.from(skuByInventoryItemId.keys());
  for (let i = 0; i < inventoryItemIds.length; i += INVENTORY_BATCH_SIZE) {
    const batch = inventoryItemIds.slice(i, i + INVENTORY_BATCH_SIZE);
    const invUrl = `https://${domain}/admin/api/${ADMIN_API_VERSION}/inventory_items.json?ids=${batch.join(",")}`;
    let invRes: Response;
    try {
      invRes = await fetch(invUrl, {
        headers: {
          "X-Shopify-Access-Token": adminToken,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch (e) {
      console.warn(
        `shopify-catalog: inventory_items batch ${i} network error`,
        (e as Error).message,
      );
      continue;
    }
    if (!invRes.ok) {
      console.warn(
        `shopify-catalog: inventory_items HTTP ${invRes.status} for batch ${i}`,
        (await invRes.text().catch(() => "")).slice(0, 200),
      );
      continue;
    }
    const invData = (await invRes.json()) as {
      inventory_items?: { id?: number; cost?: string | null }[];
    };
    for (const item of invData.inventory_items ?? []) {
      if (typeof item.id !== "number") continue;
      const sku = skuByInventoryItemId.get(item.id);
      if (!sku || item.cost == null) continue;
      const product = map[sku];
      if (product) product.cost = String(item.cost);
    }
  }

  const result: ShopifyCatalogResult = {
    ok: true,
    map,
    productCount: Object.keys(map).length,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    shopDomain: domain,
  };
  await upstashSetEx(CACHE_KEY, JSON.stringify(result), CACHE_TTL_SECONDS);
  return NextResponse.json(result);
}

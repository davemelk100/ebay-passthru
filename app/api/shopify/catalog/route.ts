import "server-only";
import { NextResponse } from "next/server";
import type { ShopifyCatalogResult, ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worst case: 5,800+ products at 250/page ≈ 24 GraphQL round trips.
export const maxDuration = 300;

const STOREFRONT_API_VERSION = "2024-10";
const CACHE_KEY = "shopify:catalog:v4"; // bumped — storefront shape (no cost)
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
const PRODUCTS_PER_PAGE = 250; // Storefront API max
const VARIANTS_PER_PRODUCT = 100;

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

interface MoneyV2 {
  amount: string;
  currencyCode: string;
}

interface StorefrontProductsResponse {
  data?: {
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{
        node: {
          title: string;
          handle: string;
          createdAt: string;
          variants: {
            edges: Array<{
              node: {
                sku: string | null;
                price: MoneyV2;
                compareAtPrice: MoneyV2 | null;
              };
            }>;
          };
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

// Storefront GraphQL query. Pagination uses cursor-based pageInfo per
// Shopify's spec (not REST Link headers). Each product fans out into its
// variants so we get SKU + price in one round trip per product page.
const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: ${PRODUCTS_PER_PAGE}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          title
          handle
          createdAt
          variants(first: ${VARIANTS_PER_PRODUCT}) {
            edges {
              node {
                sku
                price { amount currencyCode }
                compareAtPrice { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`;

export async function GET() {
  const domainRaw = process.env.SHOPIFY_SHOP_DOMAIN?.trim() ?? "";
  const domain = domainRaw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const storefrontToken = process.env.SHOPIFY_STOREFRONT_TOKEN?.trim() ?? "";

  const missing: string[] = [];
  if (!domain) missing.push("SHOPIFY_SHOP_DOMAIN");
  if (!storefrontToken) missing.push("SHOPIFY_STOREFRONT_TOKEN");
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `Missing env vars: ${missing.join(", ")}`,
        hint:
          "SHOPIFY_STOREFRONT_TOKEN is the Storefront API access token (starts with shpss_). " +
          "Generated from the app's Storefront API tokens screen.",
      } satisfies ShopifyCatalogResult,
      { status: 412 },
    );
  }

  const cached = await upstashGet(CACHE_KEY);
  if (cached) {
    try {
      return NextResponse.json(JSON.parse(cached) as ShopifyCatalogResult);
    } catch {
      /* fall through */
    }
  }

  const map: Record<string, ShopifyProduct> = {};
  const started = Date.now();
  let cursor: string | null = null;
  let pageCount = 0;
  const endpoint = `https://${domain}/api/${STOREFRONT_API_VERSION}/graphql.json`;

  while (true) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "X-Shopify-Storefront-Access-Token": storefrontToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { cursor } }),
        cache: "no-store",
      });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `Storefront API network error on page ${pageCount + 1}: ${(e as Error).message}`,
        } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `Storefront API HTTP ${res.status} on page ${pageCount + 1}: ${body.slice(0, 200)}`,
          hint:
            res.status === 401 || res.status === 403
              ? "Token is invalid or missing required scopes (unauthenticated_read_product_listings)."
              : res.status === 430 || res.status === 429
                ? "Throttled — Storefront API leaky bucket exceeded."
                : undefined,
        } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }

    const json = (await res.json()) as StorefrontProductsResponse;
    if (json.errors?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `GraphQL errors: ${json.errors.map((e) => e.message).join("; ").slice(0, 300)}`,
        } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }
    const block = json.data?.products;
    if (!block) {
      return NextResponse.json(
        { ok: false, error: "Storefront response missing data.products" } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }

    for (const productEdge of block.edges) {
      const p = productEdge.node;
      const handle = String(p.handle ?? "");
      const title = String(p.title ?? "");
      const created_at = String(p.createdAt ?? "");
      for (const variantEdge of p.variants.edges) {
        const v = variantEdge.node;
        const sku = String(v.sku ?? "").trim();
        if (!sku) continue;
        map[sku] = {
          sku,
          handle,
          title,
          created_at,
          price: String(v.price?.amount ?? ""),
          compareAtPrice: v.compareAtPrice?.amount ? String(v.compareAtPrice.amount) : undefined,
        };
      }
    }
    pageCount += 1;
    if (!block.pageInfo.hasNextPage || !block.pageInfo.endCursor) break;
    cursor = block.pageInfo.endCursor;
    if (pageCount > 50) break; // safety ceiling: 50 × 250 = 12,500 products
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

import "server-only";
import { NextResponse } from "next/server";
import type { ShopifyCatalogResult, ShopifyProduct } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worst case: full catalog walk through ~30 pages of 250 products each.
export const maxDuration = 120;

const CACHE_KEY = "shopify:catalog:v1";
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
const PAGE_LIMIT = 250;

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

interface RawShopifyVariant {
  sku?: string;
  price?: string;
  compare_at_price?: string;
}
interface RawShopifyProduct {
  id?: number;
  title?: string;
  handle?: string;
  created_at?: string;
  published_at?: string;
  vendor?: string;
  variants?: RawShopifyVariant[];
}

export async function GET() {
  const domainRaw = process.env.SHOPIFY_SHOP_DOMAIN?.trim() ?? "";
  // Strip protocol if user pasted a full URL.
  const domain = domainRaw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!domain) {
    return NextResponse.json(
      {
        ok: false,
        error: "SHOPIFY_SHOP_DOMAIN not set",
        hint: "Set SHOPIFY_SHOP_DOMAIN to your store (e.g. legacycardz.myshopify.com).",
      } satisfies ShopifyCatalogResult,
      { status: 412 },
    );
  }

  // Cached?
  const cached = await upstashGet(CACHE_KEY);
  if (cached) {
    try {
      return NextResponse.json(JSON.parse(cached) as ShopifyCatalogResult);
    } catch {
      /* fall through and re-fetch */
    }
  }

  const map: Record<string, ShopifyProduct> = {};
  let page = 1;
  const started = Date.now();
  for (;;) {
    const url = `https://${domain}/products.json?limit=${PAGE_LIMIT}&page=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: `Network error fetching ${url}: ${(e as Error).message}`,
        } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Shopify returned HTTP ${res.status} on page ${page}.`,
          hint:
            res.status === 404
              ? "Storefront /products.json is disabled on this shop."
              : undefined,
        } satisfies ShopifyCatalogResult,
        { status: 502 },
      );
    }
    const data = (await res.json()) as { products?: RawShopifyProduct[] };
    const products = data.products ?? [];
    if (products.length === 0) break;
    for (const p of products) {
      const handle = String(p.handle ?? "");
      const title = String(p.title ?? "");
      const created_at = String(p.created_at ?? "");
      for (const v of p.variants ?? []) {
        const sku = String(v.sku ?? "").trim();
        if (!sku) continue;
        // Last write wins if duplicate SKUs across variants.
        map[sku] = {
          sku,
          handle,
          title,
          created_at,
          price: String(v.price ?? ""),
          compareAtPrice: v.compare_at_price ? String(v.compare_at_price) : undefined,
        };
      }
    }
    if (products.length < PAGE_LIMIT) break;
    page += 1;
    // Cheap protective ceiling — 30 pages × 250 = 7500 products is plenty for v1.
    if (page > 30) break;
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

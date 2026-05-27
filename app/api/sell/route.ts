import { NextResponse } from "next/server";
import { blockIfProduction, requireEbayConfig } from "@/lib/api-guards";
import { callSellApi, type SellMethod } from "@/lib/ebay-sell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MUTATING_METHODS: ReadonlySet<SellMethod> = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export async function POST(req: Request) {
  let body: { method?: string; path?: string; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const method = String(body.method ?? "GET").toUpperCase() as SellMethod;
  const path = (body.path ?? "").trim();

  if (!path) {
    return NextResponse.json({ error: "Missing path." }, { status: 400 });
  }
  if (!path.startsWith("/")) {
    return NextResponse.json(
      { error: "path must start with '/' (e.g. '/sell/inventory/v1/inventory_item')." },
      { status: 400 },
    );
  }
  if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    return NextResponse.json(
      { error: `Unsupported method '${method}'. Use GET / POST / PUT / DELETE / PATCH.` },
      { status: 400 },
    );
  }

  const guard = requireEbayConfig();
  if (guard.response) return guard.response;
  const { cfg } = guard;

  const blocked = blockIfProduction(cfg, {
    blocked: MUTATING_METHODS.has(method),
    error: `${method} ${path} is permanently disabled in production — mutating Sell REST calls are blocked.`,
    details: { method, path, env: cfg.env },
  });
  if (blocked) return blocked;

  try {
    const result = await callSellApi(method, path, body.body, cfg);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Sell API request failed.", detail: (err as Error).message },
      { status: 502 },
    );
  }
}

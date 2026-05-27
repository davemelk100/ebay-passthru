import { NextResponse } from "next/server";
import { callTradingApi, configIssues, readConfig } from "@/lib/ebay";
import { blockIfProduction, requireEbayConfig } from "@/lib/api-guards";
import { DESTRUCTIVE_CALLS, PRODUCTION_ALLOWED_CALLS } from "@/lib/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { callName?: string; xml?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const callName = (body.callName ?? "").trim();
  const xml = body.xml ?? "";

  if (!callName) {
    return NextResponse.json({ error: "Missing callName." }, { status: 400 });
  }

  const guard = requireEbayConfig({ hint: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;

  // Defense in depth: in production, accept only the read-only allowlist. This
  // rejects every Trading call we haven't explicitly vetted — including ones
  // that are destructive but happen to be missing from DESTRUCTIVE_CALLS, and
  // ones that read sensitive data (GetOrders/GetMyMessages/GetAccount/etc.).
  if (cfg.env === "production" && !PRODUCTION_ALLOWED_CALLS.has(callName)) {
    return NextResponse.json(
      {
        error: `${callName} is not permitted in production. Only read-only calls are allowed.`,
        allowed: Array.from(PRODUCTION_ALLOWED_CALLS).sort(),
        callName,
        env: cfg.env,
      },
      { status: 403 },
    );
  }

  const blocked = blockIfProduction(cfg, {
    blocked: DESTRUCTIVE_CALLS.has(callName),
    error: `${callName} is blocked in production — destructive Trading calls are disabled.`,
    details: { callName, env: cfg.env },
  });
  if (blocked) return blocked;

  try {
    const result = await callTradingApi(callName, xml, cfg);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Trading API request failed.", detail: (err as Error).message },
      { status: 502 },
    );
  }
}

export async function GET() {
  const cfg = readConfig();
  return NextResponse.json({
    env: cfg.env,
    siteId: cfg.siteId,
    compatLevel: cfg.compatLevel,
    missing: configIssues(cfg),
  });
}

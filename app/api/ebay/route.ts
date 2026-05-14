import { NextResponse } from "next/server";
import { callTradingApi, configIssues, readConfig } from "@/lib/ebay";
import { blockIfProduction, requireEbayConfig } from "@/lib/api-guards";
import { DESTRUCTIVE_CALLS } from "@/lib/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { callName?: string; xml?: string; allowProduction?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const callName = (body.callName ?? "").trim();
  const xml = body.xml ?? "";
  const allowProduction = body.allowProduction === true;

  if (!callName) {
    return NextResponse.json({ error: "Missing callName." }, { status: 400 });
  }

  const guard = requireEbayConfig({ hint: true });
  if (guard.response) return guard.response;
  const { cfg } = guard;

  const blocked = blockIfProduction(cfg, {
    blocked: DESTRUCTIVE_CALLS.has(callName),
    allowProduction,
    error: `${callName} is blocked in production without an explicit opt-in.`,
    hint: "Re-send with allowProduction:true in the body to bypass — this call mutates real seller data.",
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

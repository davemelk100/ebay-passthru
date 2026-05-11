import { NextResponse } from "next/server";
import { callTradingApi, configIssues, readConfig } from "@/lib/ebay";

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

  const cfg = readConfig();
  const missing = configIssues(cfg);
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "Missing eBay credentials.",
        missing,
        hint: "Copy .env.local.example to .env.local and fill in your keys.",
      },
      { status: 412 },
    );
  }

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

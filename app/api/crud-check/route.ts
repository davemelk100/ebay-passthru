import { NextResponse } from "next/server";
import { callTradingApi, type EbayCallResult } from "@/lib/ebay";
import { blockIfProduction, requireEbayConfig } from "@/lib/api-guards";
import { SAMPLE_BODIES } from "@/lib/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StepReport {
  step: "Create" | "Read" | "Update" | "Delete";
  callName: string;
  pass: boolean;
  ack?: string;
  errors: EbayCallResult["errors"];
  durationMs: number;
  itemId?: string;
  note?: string;
}

export async function POST(req: Request) {
  const guard = requireEbayConfig();
  if (guard.response) return guard.response;
  const { cfg } = guard;

  // Safety: never run CRUD against production by default — the Create step would publish a real listing.
  let allowProduction = false;
  try {
    const body = (await req.json()) as { allowProduction?: boolean };
    allowProduction = body.allowProduction === true;
  } catch {
    // no body — fine
  }

  const blocked = blockIfProduction(cfg, {
    blocked: true,
    allowProduction,
    error:
      "CRUD check is blocked in production unless allowProduction:true is passed — AddItem would publish a real listing.",
  });
  if (blocked) return blocked;

  const report: StepReport[] = [];
  let itemId: string | undefined;

  // CREATE — AddItem
  const create = await callTradingApi("AddItem", SAMPLE_BODIES.AddItem, cfg);
  itemId = readItemId(create);
  report.push({
    step: "Create",
    callName: "AddItem",
    pass: create.ok && Boolean(itemId),
    ack: create.ack,
    errors: create.errors,
    durationMs: create.durationMs,
    itemId,
    note: itemId
      ? `Listed test item ${itemId}`
      : "AddItem did not return an ItemID — see errors. Sandbox often rejects sample listings missing required policies.",
  });

  // READ — GetItem (only if we got an ItemID)
  if (itemId) {
    const readBody = `<ItemID>${itemId}</ItemID>\n<DetailLevel>ReturnAll</DetailLevel>`;
    const r = await callTradingApi("GetItem", readBody, cfg);
    report.push({
      step: "Read",
      callName: "GetItem",
      pass: r.ok,
      ack: r.ack,
      errors: r.errors,
      durationMs: r.durationMs,
      itemId,
    });
  } else {
    report.push({
      step: "Read",
      callName: "GetItem",
      pass: false,
      errors: [],
      durationMs: 0,
      note: "Skipped — no ItemID from AddItem.",
    });
  }

  // UPDATE — ReviseItem
  if (itemId) {
    const updateBody = `<Item><ItemID>${itemId}</ItemID><Title>Passthru test listing (revised)</Title></Item>`;
    const u = await callTradingApi("ReviseItem", updateBody, cfg);
    report.push({
      step: "Update",
      callName: "ReviseItem",
      pass: u.ok,
      ack: u.ack,
      errors: u.errors,
      durationMs: u.durationMs,
      itemId,
    });
  } else {
    report.push({
      step: "Update",
      callName: "ReviseItem",
      pass: false,
      errors: [],
      durationMs: 0,
      note: "Skipped — no ItemID.",
    });
  }

  // DELETE — EndItem (always attempt cleanup if we have an ItemID)
  if (itemId) {
    const endBody = `<ItemID>${itemId}</ItemID>\n<EndingReason>NotAvailable</EndingReason>`;
    const d = await callTradingApi("EndItem", endBody, cfg);
    report.push({
      step: "Delete",
      callName: "EndItem",
      pass: d.ok,
      ack: d.ack,
      errors: d.errors,
      durationMs: d.durationMs,
      itemId,
    });
  } else {
    report.push({
      step: "Delete",
      callName: "EndItem",
      pass: false,
      errors: [],
      durationMs: 0,
      note: "Skipped — no ItemID.",
    });
  }

  const summary = {
    env: cfg.env,
    overallPass: report.every((r) => r.pass),
    itemId,
    steps: report,
  };

  return NextResponse.json(summary);
}

function readItemId(result: EbayCallResult): string | undefined {
  const parsed = result.parsed as Record<string, unknown> | null;
  const resp = parsed?.AddItemResponse as Record<string, unknown> | undefined;
  const id = resp?.ItemID;
  return id !== undefined && id !== null ? String(id) : undefined;
}

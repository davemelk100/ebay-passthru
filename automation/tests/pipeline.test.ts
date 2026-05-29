import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_CARDZ_DEFAULTS } from "../src/domain/fees.js";
import { processOffer, type ActiveRuleSet, type AuditRowInput, type PipelineDeps } from "../src/domain/pipeline.js";
import type { OfferContext, Rule } from "../src/domain/evaluator.js";

const ACCEPT_HIGH: Rule = {
  name: "accept-high",
  when: { ratio_gte: 0.85 },
  action: { type: "accept", message: "thanks" },
};
const DECLINE_LOW: Rule = {
  name: "decline-low",
  when: { ratio_lt: 0.6 },
  action: { type: "decline", message: "below floor" },
};
const COUNTER_MID: Rule = {
  name: "counter-mid",
  when: { ratio_gte: 0.6, ratio_lt: 0.85 },
  action: { type: "counter", price: { stat: "median", from: "comps", fallback: 70 } },
};

const ACTIVE_RULESET: ActiveRuleSet = {
  id: "rs-uuid",
  version: 7,
  rules: [ACCEPT_HIGH, COUNTER_MID, DECLINE_LOW],
  feeProfile: LEGACY_CARDZ_DEFAULTS,
};

const OFFER: OfferContext = {
  itemId: "ITEM-1",
  bestOfferId: "BO-1",
  buyerUserId: "buyer42",
  offerPrice: 50,
  listingPrice: 100,
  quantity: 1,
  currency: "USD",
  comps: [],
};

interface DepsCaptures {
  insertedRows: AuditRowInput[];
  respondCalls: Parameters<PipelineDeps["respondToBestOffer"]>[0][];
}

function makeDeps(overrides: Partial<PipelineDeps> = {}): { deps: PipelineDeps; captures: DepsCaptures } {
  const captures: DepsCaptures = { insertedRows: [], respondCalls: [] };
  const deps: PipelineDeps = {
    findExistingDecision: vi.fn().mockResolvedValue(null),
    loadActiveRuleSet: vi.fn().mockResolvedValue(ACTIVE_RULESET),
    resolvePause: vi.fn().mockResolvedValue({ paused: false }),
    insertDecision: vi.fn(async (row: AuditRowInput) => {
      captures.insertedRows.push(row);
      return { id: "audit-uuid" };
    }),
    respondToBestOffer: vi.fn(async (input) => {
      captures.respondCalls.push(input);
      return {
        ok: true,
        status: 200,
        ack: "Success",
        errors: [],
        rawXml: "",
        parsed: null,
        endpoint: "https://api.sandbox.ebay.com/ws/api.dll",
        durationMs: 12,
      };
    }),
    ...overrides,
  };
  return { deps, captures };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("processOffer — happy paths", () => {
  it("ACCEPT path: writes accept audit row, calls RespondToBestOffer with Accept", async () => {
    const { deps, captures } = makeDeps();
    const r = await processOffer({ source: "notification", offer: { ...OFFER, offerPrice: 90 } }, deps);
    expect(r.decision.action).toBe("accept");
    expect(r.auditDecision).toBe("accept");
    expect(r.execution?.attempted).toBe(true);
    expect(r.execution?.ack).toBe("Success");
    expect(captures.respondCalls).toHaveLength(1);
    expect(captures.respondCalls[0]).toMatchObject({
      action: "accept",
      bestOfferId: "BO-1",
      itemId: "ITEM-1",
      message: "thanks",
    });
    expect(captures.insertedRows).toHaveLength(1);
    expect(captures.insertedRows[0]).toMatchObject({
      decision: "accept",
      matchedRuleId: "accept-high",
      ruleSetVersion: 7,
      grossOffer: 90,
      ack: "Success",
    });
  });

  it("DECLINE path: writes decline row, sends Decline to eBay", async () => {
    const { deps, captures } = makeDeps();
    const r = await processOffer({ source: "notification", offer: { ...OFFER, offerPrice: 30 } }, deps);
    expect(r.decision.action).toBe("decline");
    expect(r.auditDecision).toBe("decline");
    expect(captures.respondCalls[0]?.action).toBe("decline");
  });

  it("COUNTER path: computes counter price and threads it to eBay + audit", async () => {
    const { deps, captures } = makeDeps();
    const r = await processOffer(
      { source: "notification", offer: { ...OFFER, offerPrice: 70, comps: [70, 75, 80] } },
      deps,
    );
    expect(r.decision.action).toBe("counter");
    expect(captures.respondCalls[0]).toMatchObject({
      action: "counter",
      counterPrice: 75,
      counterQuantity: 1,
    });
    expect(captures.insertedRows[0]).toMatchObject({
      decision: "counter",
      counterPrice: 75,
      counterQuantity: 1,
    });
  });
});

describe("processOffer — idempotency", () => {
  it("returns the existing audit row when bestOfferId has already been decided", async () => {
    const { deps, captures } = makeDeps({
      findExistingDecision: vi.fn().mockResolvedValue({ id: "prev-audit", decision: "accept" }),
    });
    const r = await processOffer({ source: "reconciliation", offer: OFFER }, deps);
    expect(r.alreadyDecided).toBe(true);
    expect(r.auditRowId).toBe("prev-audit");
    expect(r.auditDecision).toBe("accept");
    expect(captures.insertedRows).toHaveLength(0);
    expect(captures.respondCalls).toHaveLength(0);
  });
});

describe("processOffer — dry-run", () => {
  it("maps accept → would_have_accepted and does NOT call eBay", async () => {
    const { deps, captures } = makeDeps();
    const r = await processOffer(
      { source: "notification", offer: { ...OFFER, offerPrice: 90 }, dryRun: true },
      deps,
    );
    expect(r.auditDecision).toBe("would_have_accepted");
    expect(r.execution).toBeUndefined();
    expect(captures.respondCalls).toHaveLength(0);
    expect(captures.insertedRows[0]).toMatchObject({
      decision: "would_have_accepted",
      dryRun: true,
      matchedRuleId: "accept-high",
    });
  });
  it("maps counter → would_have_countered and records the price the engine produced", async () => {
    const { deps, captures } = makeDeps();
    const r = await processOffer(
      {
        source: "notification",
        offer: { ...OFFER, offerPrice: 70, comps: [70, 75, 80] },
        dryRun: true,
      },
      deps,
    );
    expect(r.auditDecision).toBe("would_have_countered");
    expect(captures.insertedRows[0]).toMatchObject({
      decision: "would_have_countered",
      counterPrice: 75,
      dryRun: true,
    });
  });
});

describe("processOffer — pause switches", () => {
  it("skips when an item is paused and records the reason in the audit row", async () => {
    const { deps, captures } = makeDeps({
      resolvePause: vi.fn().mockResolvedValue({ paused: true, reason: "manual review" }),
    });
    const r = await processOffer(
      { source: "notification", offer: { ...OFFER, offerPrice: 90 } },
      deps,
    );
    expect(r.auditDecision).toBe("skipped");
    expect(r.decision.action).toBe("no-match");
    if (r.decision.action === "no-match") {
      expect(r.decision.reason).toMatch(/manual review/);
    }
    expect(captures.respondCalls).toHaveLength(0);
    expect(captures.insertedRows[0]).toMatchObject({ decision: "skipped" });
  });
});

describe("processOffer — no published ruleset", () => {
  it("skips, audits, and does not call eBay", async () => {
    const { deps, captures } = makeDeps({
      loadActiveRuleSet: vi.fn().mockResolvedValue(null),
    });
    const r = await processOffer({ source: "notification", offer: OFFER }, deps);
    expect(r.auditDecision).toBe("skipped");
    expect(captures.respondCalls).toHaveLength(0);
    expect(captures.insertedRows[0]).toMatchObject({
      decision: "skipped",
      ruleSetVersion: 0,
    });
  });
});

describe("processOffer — no rule matches", () => {
  it("audits a no-match as skipped without calling eBay", async () => {
    const { deps, captures } = makeDeps({
      loadActiveRuleSet: vi.fn().mockResolvedValue({
        ...ACTIVE_RULESET,
        rules: [ACCEPT_HIGH], // only fires at ratio>=0.85
      }),
    });
    const r = await processOffer(
      { source: "notification", offer: { ...OFFER, offerPrice: 50 } },
      deps,
    );
    expect(r.decision.action).toBe("no-match");
    expect(r.auditDecision).toBe("skipped");
    expect(captures.respondCalls).toHaveLength(0);
  });
});

describe("processOffer — fee snapshot", () => {
  it("records the fee profile and breakdown in the audit row", async () => {
    const { deps, captures } = makeDeps();
    await processOffer({ source: "notification", offer: { ...OFFER, offerPrice: 90 } }, deps);
    const row = captures.insertedRows[0]!;
    expect(row.feeProfileSnapshot).toEqual(LEGACY_CARDZ_DEFAULTS);
    expect(row.feeBreakdown.fvfRaw).toBeCloseTo(90 * 0.1235, 5);
    expect(row.feeBreakdown.estimatedNet).toBeCloseTo(90 - 90 * 0.1235 * 0.9 - 0.4, 5);
  });
});

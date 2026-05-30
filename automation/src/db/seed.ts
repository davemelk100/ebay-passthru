// Dev seed script. Idempotent — re-runs without re-seeding unless
// SEED_FORCE=1. Inserts:
//   1. A published rule_set with the 8 sample rules ported from the
//      parent repo's lib/counter-bid-rules.json, plus the Legacy Cardz
//      fee profile defaults.
//   2. A handful of synthetic offer_decision rows so the history page
//      isn't empty on first boot.
//
// Usage:
//   npm run db:seed
//   SEED_FORCE=1 npm run db:seed     # bumps a new version + adds more decisions
//
// Both inserts run through the same queries the route handlers use, so
// anything the seed produces is identical to what an operator clicking
// through the admin UI would create.

import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import { createDraft, listRuleSets, publishRuleSet } from "./rule-set-queries.js";
import { offerDecision } from "./schema.js";
import { LEGACY_CARDZ_DEFAULTS, computeFees } from "../domain/fees.js";
import { log } from "../lib/log.js";
import type { RuleSetBody } from "../domain/rules-schema.js";
import type { AuditDecisionKind } from "../domain/pipeline.js";

// ─────────────────────────────────────────────────────────────────────────────
// Sample rule set — verbatim port of lib/counter-bid-rules.json
// ─────────────────────────────────────────────────────────────────────────────

const SEED_RULES: RuleSetBody = {
  rules: [
    {
      name: "graded-psa10-hold-firm",
      when: { grader_in: ["PSA"], grade_gte: 10, ratio_lt: 0.95 },
      action: {
        type: "counter",
        price: { stat: "p90", from: "comps", fallback: 0 },
        message: "This is a PSA 10 — sticking close to asking.",
      },
    },
    {
      name: "graded-95plus-counter-p75",
      when: { is_graded: true, grade_gte: 9.5, ratio_lt: 0.9 },
      action: {
        type: "counter",
        price: { stat: "p75", from: "comps", fallback: 0 },
        message: "High-grade slab — would you do this price?",
      },
    },
    {
      name: "graded-9-counter-median",
      when: { is_graded: true, grade_gte: 9, grade_lt: 9.5, ratio_lt: 0.85 },
      action: {
        type: "counter",
        price: { stat: "median", from: "comps", fallback: 0 },
        message: "Thanks for the offer — countering at comp median.",
      },
    },
    {
      name: "graded-low-decline-floor",
      when: { is_graded: true, ratio_lt: 0.65 },
      action: { type: "decline", message: "Graded card — that offer's below my floor." },
    },
    {
      name: "accept-near-asking",
      when: { ratio_gte: 0.85 },
      action: { type: "accept" },
    },
    {
      name: "counter-to-comp-median",
      when: { ratio_gte: 0.6, ratio_lt: 0.85, comps_min_count: 3 },
      action: {
        type: "counter",
        price: { stat: "median", from: "comps" },
        message: "Thanks for the offer! Would you do this price?",
      },
    },
    {
      name: "counter-mid-range-no-comps",
      when: { ratio_gte: 0.6, ratio_lt: 0.85 },
      action: {
        type: "counter",
        price: { stat: "p75", from: "comps", fallback: 0 },
        message: "Thanks for the offer! Would you do this price?",
      },
    },
    {
      name: "decline-lowballs",
      when: { ratio_lt: 0.6 },
      action: { type: "decline", message: "Thanks, but this is below my floor." },
    },
  ],
  feeProfile: LEGACY_CARDZ_DEFAULTS,
};

// ─────────────────────────────────────────────────────────────────────────────
// Sample decisions for the history view
// ─────────────────────────────────────────────────────────────────────────────

interface DecisionSeed {
  source: "notification" | "reconciliation";
  bestOfferId: string;
  itemId: string;
  buyerUserId: string;
  quantity: number;
  currency: string;
  grossOffer: number;
  grossBin: number;
  ruleSetVersion: number;
  matchedRuleId?: string;
  decision: AuditDecisionKind;
  counterPrice?: number;
  counterQuantity?: number;
  dryRun: boolean;
  /** Receive offset relative to now, in hours. Negative = past. */
  hoursAgo: number;
  ack?: string;
}

function decisionSeeds(ruleSetVersion: number): DecisionSeed[] {
  return [
    {
      source: "notification",
      bestOfferId: "SEED-BO-001",
      itemId: "267653529078",
      buyerUserId: "buyer_alpha",
      quantity: 1,
      currency: "USD",
      grossOffer: 220,
      grossBin: 250,
      ruleSetVersion,
      matchedRuleId: "accept-near-asking",
      decision: "accept",
      dryRun: false,
      hoursAgo: 0.25,
      ack: "Success",
    },
    {
      source: "notification",
      bestOfferId: "SEED-BO-002",
      itemId: "267653529773",
      buyerUserId: "buyer_beta",
      quantity: 1,
      currency: "USD",
      grossOffer: 35,
      grossBin: 100,
      ruleSetVersion,
      matchedRuleId: "decline-lowballs",
      decision: "decline",
      dryRun: false,
      hoursAgo: 1.5,
      ack: "Success",
    },
    {
      source: "notification",
      bestOfferId: "SEED-BO-003",
      itemId: "267653533126",
      buyerUserId: "buyer_gamma",
      quantity: 1,
      currency: "USD",
      grossOffer: 60,
      grossBin: 100,
      ruleSetVersion,
      matchedRuleId: "counter-mid-range-no-comps",
      decision: "counter",
      counterPrice: 75,
      counterQuantity: 1,
      dryRun: false,
      hoursAgo: 3,
      ack: "Success",
    },
    {
      source: "reconciliation",
      bestOfferId: "SEED-BO-004",
      itemId: "267653529483",
      buyerUserId: "buyer_delta",
      quantity: 1,
      currency: "USD",
      grossOffer: 90,
      grossBin: 100,
      ruleSetVersion,
      matchedRuleId: "accept-near-asking",
      decision: "would_have_accepted",
      dryRun: true,
      hoursAgo: 5,
    },
    {
      source: "reconciliation",
      bestOfferId: "SEED-BO-005",
      itemId: "267653529602",
      buyerUserId: "buyer_eps",
      quantity: 1,
      currency: "USD",
      grossOffer: 45,
      grossBin: 80,
      ruleSetVersion,
      matchedRuleId: "decline-lowballs",
      decision: "would_have_declined",
      dryRun: true,
      hoursAgo: 7,
    },
    {
      source: "notification",
      bestOfferId: "SEED-BO-006",
      itemId: "SEED-PAUSED-ITEM",
      buyerUserId: "buyer_zeta",
      quantity: 1,
      currency: "USD",
      grossOffer: 95,
      grossBin: 100,
      ruleSetVersion,
      decision: "skipped",
      dryRun: false,
      hoursAgo: 9,
    },
    {
      source: "notification",
      bestOfferId: "SEED-BO-007",
      itemId: "267653529078",
      buyerUserId: "buyer_eta",
      quantity: 1,
      currency: "USD",
      grossOffer: 240,
      grossBin: 250,
      ruleSetVersion,
      matchedRuleId: "accept-near-asking",
      decision: "accept",
      dryRun: false,
      hoursAgo: 24,
      ack: "Failure",
    },
    {
      source: "notification",
      bestOfferId: "SEED-BO-008",
      itemId: "SEED-PSA10-CARD",
      buyerUserId: "buyer_theta",
      quantity: 1,
      currency: "USD",
      grossOffer: 1700,
      grossBin: 2000,
      ruleSetVersion,
      matchedRuleId: "graded-psa10-hold-firm",
      decision: "counter",
      counterPrice: 1950,
      counterQuantity: 1,
      dryRun: false,
      hoursAgo: 30,
      ack: "Success",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert sample decisions
// ─────────────────────────────────────────────────────────────────────────────

async function seedDecisions(ruleSetVersion: number): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const seed of decisionSeeds(ruleSetVersion)) {
    const fees = computeFees(seed.grossOffer * seed.quantity, LEGACY_CARDZ_DEFAULTS);
    const receivedAt = new Date(Date.now() - seed.hoursAgo * 60 * 60 * 1000);
    const errors = seed.ack === "Failure"
      ? [{ code: "21916335", shortMessage: "Best Offer is no longer valid.", severity: "Error" }]
      : null;
    const result = await db
      .insert(offerDecision)
      .values({
        receivedAt,
        source: seed.source,
        correlationId: randomUUID(),
        bestOfferId: seed.bestOfferId,
        itemId: seed.itemId,
        buyerUserId: seed.buyerUserId,
        quantity: seed.quantity,
        currency: seed.currency,
        grossOffer: String(seed.grossOffer),
        grossBin: String(seed.grossBin),
        feeProfileSnapshot: LEGACY_CARDZ_DEFAULTS,
        fvfRaw: String(fees.fvfRaw),
        fvfAfterTrs: String(fees.fvfAfterTrs),
        fixedFee: String(fees.fixedFee),
        estimatedNet: String(fees.estimatedNet),
        ruleSetVersion: seed.ruleSetVersion,
        matchedRuleId: seed.matchedRuleId,
        decision: seed.decision,
        counterPrice: seed.counterPrice !== undefined ? String(seed.counterPrice) : null,
        counterQuantity: seed.counterQuantity ?? null,
        dryRun: seed.dryRun,
        ack: seed.ack,
        errors,
      })
      .onConflictDoNothing({ target: offerDecision.bestOfferId })
      .returning({ id: offerDecision.id });
    if (result.length > 0) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const force = process.env.SEED_FORCE === "1";

  log.info({ force }, "seed: starting");

  const existing = await listRuleSets(db, { status: "published", limit: 1 });
  let publishedVersion: number;
  if (existing.length > 0 && !force) {
    publishedVersion = existing[0]!.version;
    log.info(
      { publishedVersion },
      "seed: a published rule set already exists; set SEED_FORCE=1 to publish a fresh draft alongside",
    );
  } else {
    const draft = await createDraft(db, SEED_RULES);
    const published = await publishRuleSet(db, draft.id, "seed-script");
    publishedVersion = published.version;
    log.info(
      { version: publishedVersion, rules: SEED_RULES.rules.length },
      "seed: published rule set",
    );
  }

  const { inserted, skipped } = await seedDecisions(publishedVersion);
  log.info({ inserted, skipped }, "seed: decisions");

  log.info("seed: done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error({ err: { message: (err as Error).message, stack: (err as Error).stack } }, "seed failed");
    process.exit(1);
  });

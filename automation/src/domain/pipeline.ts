// End-to-end decision pipeline for a single buyer offer.
//
// Wires together: idempotency, pause check, active rule load, fee math, rule
// evaluation, RespondToBestOffer, and the append-only audit row. I/O happens
// through the `PipelineDeps` interface so unit tests can stub every external
// boundary without spinning up Postgres or the eBay sandbox.

import { randomUUID } from "node:crypto";
import { computeFees, type FeeBreakdown, type FeeProfile } from "./fees.js";
import { evaluateOffer, type Decision, type OfferContext, type Rule } from "./evaluator.js";
import type { EbayCallResult, EbayError } from "./ebay/trading.js";
import type { RespondToBestOfferInput } from "./ebay/respond.js";

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline input / output
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineInput {
  /** "notification" for push events, "reconciliation" for poll-discovered offers. */
  source: "notification" | "reconciliation";
  offer: OfferContext;
  /** Optional Buy-It-Now total for fee/margin comparison in future rule conditions. */
  binPrice?: number;
  /** When true, run the full evaluation but don't call RespondToBestOffer. */
  dryRun?: boolean;
  /** Trace id passed in from the caller; one is generated if absent. */
  correlationId?: string;
}

export type AuditDecisionKind =
  | "accept"
  | "decline"
  | "counter"
  | "skipped"
  | "would_have_accepted"
  | "would_have_declined"
  | "would_have_countered";

export interface AuditRowInput {
  source: PipelineInput["source"];
  correlationId: string;
  bestOfferId: string;
  itemId: string;
  buyerUserId?: string;
  quantity: number;
  currency: string;
  grossOffer: number;
  grossBin?: number;
  feeProfileSnapshot: FeeProfile;
  feeBreakdown: FeeBreakdown;
  ruleSetVersion: number;
  matchedRuleId?: string;
  decision: AuditDecisionKind;
  counterPrice?: number;
  counterQuantity?: number;
  dryRun: boolean;
  ack?: string;
  errors?: EbayError[];
}

export interface ActiveRuleSet {
  id: string;
  version: number;
  rules: Rule[];
  feeProfile: FeeProfile;
}

export interface PauseState {
  paused: boolean;
  reason?: string;
}

export interface PipelineDeps {
  /** Returns the existing audit row if this bestOfferId has already been decided. */
  findExistingDecision(bestOfferId: string): Promise<{ id: string; decision: AuditDecisionKind } | null>;
  /** Returns the active published ruleset, or null if there's no ruleset published yet. */
  loadActiveRuleSet(): Promise<ActiveRuleSet | null>;
  /** Returns the most specific pause that applies to this itemId (global > category > sku). */
  resolvePause(itemId: string): Promise<PauseState>;
  /** Inserts the audit row and returns the new id. Caller is responsible for any UNIQUE conflict mapping. */
  insertDecision(row: AuditRowInput): Promise<{ id: string }>;
  /** Calls eBay's RespondToBestOffer for the single offer. */
  respondToBestOffer(input: RespondToBestOfferInput): Promise<EbayCallResult>;
}

export interface PipelineResult {
  /** The decision the engine produced (regardless of whether we executed it). */
  decision: Decision;
  /** Mapped to the audit row's `decision` column. */
  auditDecision: AuditDecisionKind;
  /** id of the inserted (or pre-existing, on idempotent reentry) audit row. */
  auditRowId: string;
  /** Set only when the run actually called RespondToBestOffer. */
  execution?: {
    attempted: boolean;
    ack?: string;
    errors?: EbayError[];
  };
  /** Set when an existing audit row was found and execution was skipped. */
  alreadyDecided?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision → audit-row enum mapping
// ─────────────────────────────────────────────────────────────────────────────

function mapAuditDecision(decision: Decision, opts: { dryRun: boolean; paused: boolean }): AuditDecisionKind {
  if (opts.paused || decision.action === "no-match") return "skipped";
  if (opts.dryRun) {
    switch (decision.action) {
      case "accept":
        return "would_have_accepted";
      case "decline":
        return "would_have_declined";
      case "counter":
        return "would_have_countered";
    }
  }
  return decision.action;
}

function executable(audit: AuditDecisionKind): audit is "accept" | "decline" | "counter" {
  return audit === "accept" || audit === "decline" || audit === "counter";
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function processOffer(
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const correlationId = input.correlationId ?? randomUUID();
  const dryRun = input.dryRun ?? false;

  // 1) Idempotency — if this bestOfferId has already produced a row, return
  //    it without re-evaluating. UNIQUE(best_offer_id) at the DB layer is the
  //    real guard; this is just the fast path.
  const existing = await deps.findExistingDecision(input.offer.bestOfferId);
  if (existing) {
    return {
      decision: { action: "no-match", reason: "already decided" },
      auditDecision: existing.decision,
      auditRowId: existing.id,
      alreadyDecided: true,
    };
  }

  // 2) Load published ruleset.
  const active = await deps.loadActiveRuleSet();
  const pause = await deps.resolvePause(input.offer.itemId);

  // 3) If there's no ruleset, skip — operator hasn't configured the engine yet.
  if (!active) {
    const grossOffer = input.offer.offerPrice * input.offer.quantity;
    const fallbackProfile: FeeProfile = {
      fixedPerTransaction: 0,
      tier1Rate: 0,
      tier1Cap: 0,
      tier2Rate: 0,
      trsFvfDiscount: 0,
    };
    const fees = computeFees(grossOffer, fallbackProfile);
    const row: AuditRowInput = {
      source: input.source,
      correlationId,
      bestOfferId: input.offer.bestOfferId,
      itemId: input.offer.itemId,
      buyerUserId: input.offer.buyerUserId,
      quantity: input.offer.quantity,
      currency: input.offer.currency ?? "USD",
      grossOffer,
      grossBin: input.binPrice,
      feeProfileSnapshot: fallbackProfile,
      feeBreakdown: fees,
      ruleSetVersion: 0,
      decision: "skipped",
      dryRun,
    };
    const r = await deps.insertDecision(row);
    return {
      decision: { action: "no-match", reason: "no published ruleset" },
      auditDecision: "skipped",
      auditRowId: r.id,
    };
  }

  // 4) Fees + decision (or pause skip).
  const grossOffer = input.offer.offerPrice * input.offer.quantity;
  const fees = computeFees(grossOffer, active.feeProfile);
  const decision: Decision = pause.paused
    ? { action: "no-match", reason: `paused: ${pause.reason ?? "no reason given"}` }
    : evaluateOffer(active.rules, input.offer);

  const auditDecision = mapAuditDecision(decision, { dryRun, paused: pause.paused });

  // 5) Execute if applicable (not dryRun, not paused, not skipped).
  let execution: PipelineResult["execution"];
  if (executable(auditDecision)) {
    const respondInput: RespondToBestOfferInput = {
      itemId: input.offer.itemId,
      bestOfferId: input.offer.bestOfferId,
      action: auditDecision,
      currency: input.offer.currency ?? "USD",
      ...(auditDecision === "counter" && decision.action === "counter"
        ? {
            counterPrice: decision.counterPrice,
            counterQuantity: decision.counterQuantity,
            message: decision.message,
          }
        : {}),
      ...(("message" in decision && decision.message !== undefined) ? { message: decision.message } : {}),
    };
    const callResult = await deps.respondToBestOffer(respondInput);
    execution = {
      attempted: true,
      ack: callResult.ack,
      errors: callResult.errors,
    };
  }

  // 6) Audit row (inserted post-execution so the ack/errors are captured).
  const matchedRuleId =
    decision.action === "accept" ||
    decision.action === "decline" ||
    decision.action === "counter"
      ? decision.matchedRule
      : undefined;
  const counterPrice = decision.action === "counter" ? decision.counterPrice : undefined;
  const counterQuantity = decision.action === "counter" ? decision.counterQuantity : undefined;
  const row: AuditRowInput = {
    source: input.source,
    correlationId,
    bestOfferId: input.offer.bestOfferId,
    itemId: input.offer.itemId,
    buyerUserId: input.offer.buyerUserId,
    quantity: input.offer.quantity,
    currency: input.offer.currency ?? "USD",
    grossOffer,
    grossBin: input.binPrice,
    feeProfileSnapshot: active.feeProfile,
    feeBreakdown: fees,
    ruleSetVersion: active.version,
    matchedRuleId,
    decision: auditDecision,
    counterPrice,
    counterQuantity,
    dryRun,
    ack: execution?.ack,
    errors: execution?.errors,
  };
  const r = await deps.insertDecision(row);

  return {
    decision,
    auditDecision,
    auditRowId: r.id,
    execution,
  };
}

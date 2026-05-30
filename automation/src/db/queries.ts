// Postgres-backed implementations of the four data-shaped PipelineDeps. Each
// function takes a Db explicitly so the production factory wires a real pool
// and integration tests can hand in a per-test connection. The pipeline
// itself never reaches into Drizzle directly — keeps the rule engine,
// fee math, and DB I/O independently swappable.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FeeProfile } from "../domain/fees.js";
import type { Rule } from "../domain/evaluator.js";
import type {
  ActiveRuleSet,
  AuditRowInput,
  PauseState,
} from "../domain/pipeline.js";
import type { Db } from "./client.js";
import { offerDecision, pauseSwitch, ruleSet } from "./schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// findExistingDecision
// ─────────────────────────────────────────────────────────────────────────────
// Idempotency lookup. The pipeline fast-paths if this returns non-null;
// UNIQUE(best_offer_id) at the schema level is the real guard, but a SELECT
// before INSERT lets us short-circuit cleanly and avoid the optimistic-insert
// + duplicate-key-conflict round trip on the happy "already done" path.

export async function findExistingDecision(
  db: Db,
  bestOfferId: string,
): Promise<{ id: string; decision: AuditRowInput["decision"] } | null> {
  const rows = await db
    .select({
      id: offerDecision.id,
      decision: offerDecision.decision,
    })
    .from(offerDecision)
    .where(eq(offerDecision.bestOfferId, bestOfferId))
    .limit(1);
  return rows[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// loadActiveRuleSet
// ─────────────────────────────────────────────────────────────────────────────
// Returns the highest-version published row. Drafts and archived rows are
// invisible to the runtime. The jsonb columns deserialize as `unknown` —
// we trust the admin POST handlers (next slice) to have validated the
// shape on the way in, so the cast here is the documented boundary.

export async function loadActiveRuleSet(db: Db): Promise<ActiveRuleSet | null> {
  const rows = await db
    .select()
    .from(ruleSet)
    .where(eq(ruleSet.status, "published"))
    .orderBy(desc(ruleSet.version))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    rules: row.rules as Rule[],
    feeProfile: row.feeProfile as FeeProfile,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// resolvePause
// ─────────────────────────────────────────────────────────────────────────────
// Returns the most-specific active pause for an item. v0 supports two scopes:
//   "global"       — turns everything off
//   "item:<itemId>" — turns off a single listing
// Future scopes (sku:, category:) plug in here without API change since the
// pipeline only cares about the resolved boolean + reason.

export async function resolvePause(db: Db, itemId: string): Promise<PauseState> {
  const itemScope = `item:${itemId}`;
  const rows = await db
    .select({
      scope: pauseSwitch.scope,
      paused: pauseSwitch.paused,
      reason: pauseSwitch.reason,
    })
    .from(pauseSwitch)
    .where(
      and(
        eq(pauseSwitch.paused, true),
        inArray(pauseSwitch.scope, ["global", itemScope]),
      ),
    );

  // Most specific wins — item beats global.
  const item = rows.find((r) => r.scope === itemScope);
  if (item) return { paused: true, reason: item.reason ?? undefined };
  const global = rows.find((r) => r.scope === "global");
  if (global) return { paused: true, reason: global.reason ?? undefined };
  return { paused: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// insertDecision
// ─────────────────────────────────────────────────────────────────────────────
// Pure INSERT. numeric columns expect strings (postgres-js round-trips them
// as strings to preserve precision); we explicitly String() every monetary
// value. Conflict on the bestOfferId UNIQUE is the safety net for the rare
// case where two pipeline runs race past findExistingDecision — caller can
// catch and treat as alreadyDecided.

export async function insertDecision(
  db: Db,
  row: AuditRowInput,
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(offerDecision)
    .values({
      source: row.source,
      correlationId: row.correlationId,
      bestOfferId: row.bestOfferId,
      itemId: row.itemId,
      buyerUserId: row.buyerUserId,
      quantity: row.quantity,
      currency: row.currency,
      grossOffer: String(row.grossOffer),
      grossBin: row.grossBin !== undefined ? String(row.grossBin) : null,
      feeProfileSnapshot: row.feeProfileSnapshot,
      fvfRaw: String(row.feeBreakdown.fvfRaw),
      fvfAfterTrs: String(row.feeBreakdown.fvfAfterTrs),
      fixedFee: String(row.feeBreakdown.fixedFee),
      estimatedNet: String(row.feeBreakdown.estimatedNet),
      ruleSetVersion: row.ruleSetVersion,
      matchedRuleId: row.matchedRuleId,
      decision: row.decision,
      counterPrice: row.counterPrice !== undefined ? String(row.counterPrice) : null,
      counterQuantity: row.counterQuantity,
      dryRun: row.dryRun,
      ack: row.ack,
      errors: row.errors,
    })
    .returning({ id: offerDecision.id });
  if (!inserted) {
    throw new Error("insertDecision returned no row — likely UNIQUE conflict");
  }
  return { id: inserted.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Health probe — used by /readyz to confirm the pool is alive
// ─────────────────────────────────────────────────────────────────────────────

export async function checkDbHealth(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

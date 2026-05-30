// Filterable queries against the offer_decision audit table for the history
// UI. Inserts go through src/db/queries.ts:insertDecision — this module is
// read-only.

import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "./client.js";
import { offerDecision } from "./schema.js";

export type DecisionKind =
  | "accept"
  | "decline"
  | "counter"
  | "skipped"
  | "would_have_accepted"
  | "would_have_declined"
  | "would_have_countered";

export interface DecisionRow {
  id: string;
  receivedAt: Date;
  source: "notification" | "reconciliation";
  correlationId: string;
  bestOfferId: string;
  itemId: string;
  buyerUserId: string | null;
  quantity: number;
  currency: string;
  grossOffer: string;
  grossBin: string | null;
  feeProfileSnapshot: unknown;
  fvfRaw: string;
  fvfAfterTrs: string;
  fixedFee: string;
  estimatedNet: string;
  ruleSetVersion: number;
  matchedRuleId: string | null;
  decision: DecisionKind;
  counterPrice: string | null;
  counterQuantity: number | null;
  dryRun: boolean;
  ack: string | null;
  errors: unknown;
}

export interface DecisionFilters {
  itemId?: string;
  decision?: string;
  source?: "notification" | "reconciliation";
  ruleSetVersion?: number;
  /** ISO 8601 — inclusive lower bound on receivedAt. */
  fromIso?: string;
  /** ISO 8601 — inclusive upper bound on receivedAt. */
  toIso?: string;
  limit?: number;
}

export async function listDecisions(db: Db, filters: DecisionFilters = {}): Promise<DecisionRow[]> {
  const conditions = [];
  if (filters.itemId) conditions.push(eq(offerDecision.itemId, filters.itemId));
  if (filters.decision) {
    conditions.push(eq(offerDecision.decision, filters.decision as DecisionKind));
  }
  if (filters.source) conditions.push(eq(offerDecision.source, filters.source));
  if (filters.ruleSetVersion !== undefined) {
    conditions.push(eq(offerDecision.ruleSetVersion, filters.ruleSetVersion));
  }
  if (filters.fromIso) {
    const d = new Date(filters.fromIso);
    if (!Number.isNaN(d.valueOf())) conditions.push(gte(offerDecision.receivedAt, d));
  }
  if (filters.toIso) {
    const d = new Date(filters.toIso);
    if (!Number.isNaN(d.valueOf())) conditions.push(lte(offerDecision.receivedAt, d));
  }
  const limit = filters.limit ?? 200;
  const base = db.select().from(offerDecision);
  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(desc(offerDecision.receivedAt)).limit(limit)
      : await base.orderBy(desc(offerDecision.receivedAt)).limit(limit);
  return rows as DecisionRow[];
}

export async function getDecisionById(db: Db, id: string): Promise<DecisionRow | null> {
  const rows = await db.select().from(offerDecision).where(eq(offerDecision.id, id)).limit(1);
  return (rows[0] as DecisionRow | undefined) ?? null;
}

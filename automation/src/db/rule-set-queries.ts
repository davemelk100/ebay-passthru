// CRUD queries for the rule_set table. Each function takes Db explicitly
// so the route handlers can inject a real connection in production and
// tests can hand in a fake.
//
// Version assignment: new drafts get max(version) + 1 via two queries
// (race condition under concurrent admin writes — acceptable for v0).
// Publish: transactional swap that archives any currently-published row
// and promotes the target.

import { and, desc, eq, max } from "drizzle-orm";
import type { Db } from "./client.js";
import { ruleSet } from "./schema.js";
import type { RuleSetBody } from "../domain/rules-schema.js";

export type RuleSetStatus = "draft" | "published" | "archived";

export interface RuleSetRow {
  id: string;
  version: number;
  status: RuleSetStatus;
  rules: unknown;
  feeProfile: unknown;
  publishedAt: Date | null;
  publishedBy: string | null;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// list
// ─────────────────────────────────────────────────────────────────────────────

export async function listRuleSets(
  db: Db,
  opts: { status?: RuleSetStatus; limit?: number } = {},
): Promise<RuleSetRow[]> {
  const limit = opts.limit ?? 100;
  const base = db.select().from(ruleSet);
  const rows = opts.status
    ? await base.where(eq(ruleSet.status, opts.status)).orderBy(desc(ruleSet.version)).limit(limit)
    : await base.orderBy(desc(ruleSet.version)).limit(limit);
  return rows as RuleSetRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// getById
// ─────────────────────────────────────────────────────────────────────────────

export async function getRuleSetById(db: Db, id: string): Promise<RuleSetRow | null> {
  const rows = await db.select().from(ruleSet).where(eq(ruleSet.id, id)).limit(1);
  return (rows[0] as RuleSetRow | undefined) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// createDraft
// ─────────────────────────────────────────────────────────────────────────────
// Two-query create. Race condition rare under interactive admin traffic;
// add a transaction once concurrent edits become a real concern.

export async function createDraft(db: Db, body: RuleSetBody): Promise<RuleSetRow> {
  const [maxRow] = await db.select({ maxVersion: max(ruleSet.version) }).from(ruleSet);
  const nextVersion = (maxRow?.maxVersion ?? 0) + 1;
  const [inserted] = await db
    .insert(ruleSet)
    .values({
      version: nextVersion,
      status: "draft",
      rules: body.rules,
      feeProfile: body.feeProfile,
    })
    .returning();
  if (!inserted) throw new Error("createDraft: insert returned no row");
  return inserted as RuleSetRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDraft
// ─────────────────────────────────────────────────────────────────────────────
// WHERE clause locks the update to drafts — published / archived rows are
// immutable to keep audit references stable.

export async function updateDraft(
  db: Db,
  id: string,
  body: RuleSetBody,
): Promise<RuleSetRow> {
  const [updated] = await db
    .update(ruleSet)
    .set({ rules: body.rules, feeProfile: body.feeProfile })
    .where(and(eq(ruleSet.id, id), eq(ruleSet.status, "draft")))
    .returning();
  if (!updated) throw new Error("updateDraft: not found or not in draft state");
  return updated as RuleSetRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// publishRuleSet
// ─────────────────────────────────────────────────────────────────────────────
// Transactional swap. Demotes any currently-published row to "archived" and
// promotes the target. Supports drafts (normal publish) AND archived rows
// (rollback to a prior version).

export async function publishRuleSet(
  db: Db,
  id: string,
  publishedBy: string | null,
): Promise<RuleSetRow> {
  return db.transaction(async (tx) => {
    await tx
      .update(ruleSet)
      .set({ status: "archived" })
      .where(eq(ruleSet.status, "published"));
    const [updated] = await tx
      .update(ruleSet)
      .set({
        status: "published",
        publishedAt: new Date(),
        publishedBy,
      })
      .where(eq(ruleSet.id, id))
      .returning();
    if (!updated) throw new Error("publishRuleSet: target row not found");
    return updated as RuleSetRow;
  });
}

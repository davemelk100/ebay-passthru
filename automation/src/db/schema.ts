import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// rule_set
// One row per versioned ruleset (draft or published). The active "published"
// row is what workers read at evaluation time. Older published rows stay
// around for rollback + history reconciliation (an audit row references
// `rule_set_version`).
// ─────────────────────────────────────────────────────────────────────────────
export const ruleSet = pgTable(
  "rule_set",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    status: text("status").notNull().$type<"draft" | "published" | "archived">(),
    rules: jsonb("rules").notNull(),
    feeProfile: jsonb("fee_profile").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionIdx: uniqueIndex("rule_set_version_idx").on(t.version),
    statusIdx: index("rule_set_status_idx").on(t.status),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// fee_profile_history
// Optional standalone history of fee profile changes for audit clarity. The
// active fee profile is always embedded in the published rule_set row, but
// finance may want a separate timeline of fee assumption edits.
// ─────────────────────────────────────────────────────────────────────────────
export const feeProfileHistory = pgTable("fee_profile_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile: jsonb("profile").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  publishedBy: text("published_by"),
  note: text("note"),
});

// ─────────────────────────────────────────────────────────────────────────────
// offer_decision
// Append-only audit log — one row per buyer offer the system evaluated. Stores
// the gross offer/BIN, the fee assumption snapshot, computed fee breakdown,
// estimated net, which rule matched, the decision, and the API ack/errors.
//
// Two important invariants:
//   1. UNIQUE on best_offer_id → idempotency. A second evaluation of the
//      same offer (e.g. push notification + reconciliation poll racing)
//      is rejected at the DB level.
//   2. NEVER UPDATE rows in this table. New evaluations for the same
//      ItemID at different times produce new rows.
// ─────────────────────────────────────────────────────────────────────────────
export const offerDecision = pgTable(
  "offer_decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),

    // Provenance
    source: text("source").notNull().$type<"notification" | "reconciliation">(),
    correlationId: uuid("correlation_id").notNull().defaultRandom(),

    // Offer identity
    bestOfferId: text("best_offer_id").notNull(),
    itemId: text("item_id").notNull(),
    buyerUserId: text("buyer_user_id"),
    quantity: integer("quantity").notNull(),

    // Pricing snapshot (numeric to preserve cents exactly)
    currency: text("currency").notNull(),
    grossOffer: numeric("gross_offer", { precision: 12, scale: 2 }).notNull(),
    grossBin: numeric("gross_bin", { precision: 12, scale: 2 }),

    // Fee snapshot (what the math used — full profile preserved as JSON)
    feeProfileSnapshot: jsonb("fee_profile_snapshot").notNull(),
    fvfRaw: numeric("fvf_raw", { precision: 12, scale: 4 }).notNull(),
    fvfAfterTrs: numeric("fvf_after_trs", { precision: 12, scale: 4 }).notNull(),
    fixedFee: numeric("fixed_fee", { precision: 12, scale: 4 }).notNull(),
    estimatedNet: numeric("estimated_net", { precision: 12, scale: 2 }).notNull(),

    // Decision
    ruleSetVersion: integer("rule_set_version").notNull(),
    matchedRuleId: text("matched_rule_id"),
    decision: text("decision")
      .notNull()
      .$type<
        | "accept"
        | "decline"
        | "counter"
        | "skipped"
        | "would_have_accepted"
        | "would_have_declined"
        | "would_have_countered"
      >(),
    counterPrice: numeric("counter_price", { precision: 12, scale: 2 }),
    counterQuantity: integer("counter_quantity"),

    // Execution outcome
    dryRun: boolean("dry_run").notNull().default(false),
    ack: text("ack"),
    errors: jsonb("errors"),
  },
  (t) => ({
    bestOfferIdIdx: uniqueIndex("offer_decision_best_offer_id_idx").on(t.bestOfferId),
    itemIdIdx: index("offer_decision_item_id_idx").on(t.itemId),
    receivedAtIdx: index("offer_decision_received_at_idx").on(t.receivedAt),
    ruleVersionIdx: index("offer_decision_rule_version_idx").on(t.ruleSetVersion),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// pause_switch
// Global or scoped pause flags. Workers consult these before evaluating an
// offer; if the active scope is paused, the offer becomes a "skipped" audit
// row instead of an RespondToBestOffer call.
// ─────────────────────────────────────────────────────────────────────────────
export const pauseSwitch = pgTable(
  "pause_switch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    paused: boolean("paused").notNull().default(false),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => ({
    scopeIdx: uniqueIndex("pause_switch_scope_idx").on(t.scope),
  }),
);

// Unit-level tests for the Postgres query functions. Drizzle's chained
// query builders are picky to mock cleanly; the goal here is to verify the
// shape of what each function returns *given a fake row* a real DB would
// produce, plus a few dispatching behaviors (resolvePause specificity,
// numeric serialization in inserts). Full integration tests against a real
// Postgres live in tests/integration/queries.it.test.ts (not yet wired —
// requires DATABASE_URL pointing at an empty test database).

import { describe, expect, it, vi } from "vitest";
import { LEGACY_CARDZ_DEFAULTS } from "../../src/domain/fees.js";
import {
  findExistingDecision,
  insertDecision,
  loadActiveRuleSet,
  resolvePause,
} from "../../src/db/queries.js";
import type { Db } from "../../src/db/client.js";
import type { AuditRowInput } from "../../src/domain/pipeline.js";

// Helper to construct a fake Db where every chained .select/.insert call
// resolves to the value we specify. Returns the recording mocks so each
// test can assert against the values that were passed.
function fakeDb(opts: {
  selectRows?: unknown[];
  returningRows?: unknown[];
}): { db: Db; selectCalls: unknown[]; insertValues?: Record<string, unknown> } {
  const selectCalls: unknown[] = [];
  let insertValues: Record<string, unknown> | undefined;
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(opts.selectRows ?? []),
    values: vi.fn((v: Record<string, unknown>) => {
      insertValues = v;
      return {
        returning: vi.fn().mockResolvedValue(opts.returningRows ?? []),
      };
    }),
  };
  const db = {
    select: vi.fn((cols?: unknown) => {
      selectCalls.push(cols);
      return chain;
    }),
    insert: vi.fn().mockReturnValue(chain),
    execute: vi.fn(),
  } as unknown as Db;
  return Object.assign({ db, selectCalls }, { get insertValues() { return insertValues; } });
}

describe("findExistingDecision", () => {
  it("returns the row when one exists", async () => {
    const { db } = fakeDb({ selectRows: [{ id: "audit-1", decision: "accept" }] });
    const r = await findExistingDecision(db, "BO-1");
    expect(r).toEqual({ id: "audit-1", decision: "accept" });
  });
  it("returns null when no row exists", async () => {
    const { db } = fakeDb({ selectRows: [] });
    expect(await findExistingDecision(db, "BO-MISSING")).toBeNull();
  });
});

describe("loadActiveRuleSet", () => {
  it("returns the highest-version published row mapped to ActiveRuleSet", async () => {
    const { db } = fakeDb({
      selectRows: [
        {
          id: "rs-uuid",
          version: 5,
          status: "published",
          rules: [{ name: "r1", when: {}, action: { type: "accept" } }],
          feeProfile: LEGACY_CARDZ_DEFAULTS,
          publishedAt: new Date(),
          publishedBy: null,
          createdAt: new Date(),
        },
      ],
    });
    const r = await loadActiveRuleSet(db);
    expect(r).toEqual({
      id: "rs-uuid",
      version: 5,
      rules: [{ name: "r1", when: {}, action: { type: "accept" } }],
      feeProfile: LEGACY_CARDZ_DEFAULTS,
    });
  });
  it("returns null when no published row exists", async () => {
    const { db } = fakeDb({ selectRows: [] });
    expect(await loadActiveRuleSet(db)).toBeNull();
  });
});

describe("resolvePause", () => {
  it("returns paused=true when an item-level pause exists", async () => {
    const { db } = fakeDb({
      selectRows: [{ scope: "item:ITEM-1", paused: true, reason: "manual review" }],
    });
    const r = await resolvePause(db, "ITEM-1");
    expect(r).toEqual({ paused: true, reason: "manual review" });
  });

  it("returns paused=true when only a global pause exists", async () => {
    const { db } = fakeDb({
      selectRows: [{ scope: "global", paused: true, reason: "incident" }],
    });
    const r = await resolvePause(db, "ITEM-1");
    expect(r).toEqual({ paused: true, reason: "incident" });
  });

  it("prefers the item-level pause over the global pause when both exist", async () => {
    const { db } = fakeDb({
      selectRows: [
        { scope: "global", paused: true, reason: "incident" },
        { scope: "item:ITEM-1", paused: true, reason: "manual review" },
      ],
    });
    const r = await resolvePause(db, "ITEM-1");
    expect(r).toEqual({ paused: true, reason: "manual review" });
  });

  it("returns paused=false when nothing matches", async () => {
    const { db } = fakeDb({ selectRows: [] });
    expect(await resolvePause(db, "ITEM-1")).toEqual({ paused: false });
  });
});

describe("insertDecision", () => {
  function row(overrides: Partial<AuditRowInput> = {}): AuditRowInput {
    return {
      source: "notification",
      correlationId: "corr-uuid",
      bestOfferId: "BO-1",
      itemId: "ITEM-1",
      buyerUserId: "buyer42",
      quantity: 1,
      currency: "USD",
      grossOffer: 90,
      feeProfileSnapshot: LEGACY_CARDZ_DEFAULTS,
      feeBreakdown: {
        fvfRaw: 11.115,
        fvfAfterTrs: 10.0035,
        fixedFee: 0.4,
        feesTotal: 10.4035,
        estimatedNet: 79.5965,
      },
      ruleSetVersion: 7,
      decision: "accept",
      dryRun: false,
      ...overrides,
    };
  }

  it("serializes numeric columns as strings and returns the inserted id", async () => {
    const fake = fakeDb({ returningRows: [{ id: "audit-uuid" }] });
    const r = await insertDecision(fake.db, row());
    expect(r).toEqual({ id: "audit-uuid" });
    expect(fake.insertValues).toMatchObject({
      grossOffer: "90",
      fvfRaw: "11.115",
      fvfAfterTrs: "10.0035",
      fixedFee: "0.4",
      estimatedNet: "79.5965",
      grossBin: null,
      counterPrice: null,
      decision: "accept",
      ruleSetVersion: 7,
      dryRun: false,
    });
  });

  it("serializes counterPrice and grossBin when set", async () => {
    const fake = fakeDb({ returningRows: [{ id: "audit-uuid" }] });
    await insertDecision(
      fake.db,
      row({
        decision: "counter",
        counterPrice: 75,
        counterQuantity: 1,
        grossBin: 100,
      }),
    );
    expect(fake.insertValues).toMatchObject({
      counterPrice: "75",
      counterQuantity: 1,
      grossBin: "100",
      decision: "counter",
    });
  });

  it("throws when the INSERT returns no row (unique conflict path)", async () => {
    const fake = fakeDb({ returningRows: [] });
    await expect(insertDecision(fake.db, row())).rejects.toThrowError(/UNIQUE conflict/);
  });
});

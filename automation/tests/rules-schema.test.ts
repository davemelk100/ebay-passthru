import { describe, expect, it } from "vitest";
import {
  actionSchema,
  feeProfileSchema,
  ruleSchema,
  ruleSetBodySchema,
} from "../src/domain/rules-schema.js";

describe("ruleSchema", () => {
  it("accepts a minimal accept rule", () => {
    const r = ruleSchema.parse({
      name: "accept-high",
      when: { ratio_gte: 0.85 },
      action: { type: "accept" },
    });
    expect(r.name).toBe("accept-high");
  });

  it("accepts a counter rule with stat-based price", () => {
    const r = ruleSchema.parse({
      name: "counter-median",
      when: { ratio_gte: 0.6, ratio_lt: 0.85, comps_min_count: 3 },
      action: {
        type: "counter",
        price: { stat: "median", from: "comps", fallback: 0 },
        message: "Would you do this price?",
      },
    });
    expect(r.action.type).toBe("counter");
  });

  it("rejects unknown condition keys", () => {
    expect(() =>
      ruleSchema.parse({
        name: "x",
        when: { ratio_gte: 0.5, unknown_field: true },
        action: { type: "accept" },
      }),
    ).toThrow();
  });

  it("rejects unknown action types", () => {
    expect(() =>
      ruleSchema.parse({
        name: "x",
        when: { ratio_gte: 0.5 },
        action: { type: "explode" },
      }),
    ).toThrow();
  });

  it("rejects negative offer thresholds", () => {
    expect(() =>
      ruleSchema.parse({
        name: "x",
        when: { offer_gte: -1 },
        action: { type: "accept" },
      }),
    ).toThrow();
  });

  it("rejects message strings that are absurdly long", () => {
    expect(() =>
      ruleSchema.parse({
        name: "x",
        when: {},
        action: { type: "accept", message: "x".repeat(5000) },
      }),
    ).toThrow();
  });

  it("rejects counter rules with a quantity of zero", () => {
    expect(() =>
      ruleSchema.parse({
        name: "x",
        when: {},
        action: { type: "counter", price: 10, quantity: 0 },
      }),
    ).toThrow();
  });
});

describe("actionSchema discriminated union", () => {
  it("accepts a flat-number counter price", () => {
    const a = actionSchema.parse({ type: "counter", price: 42.5 });
    expect(a.type).toBe("counter");
  });
  it("rejects a counter without a price field", () => {
    expect(() => actionSchema.parse({ type: "counter" })).toThrow();
  });
});

describe("feeProfileSchema", () => {
  it("accepts the Legacy Cardz defaults", () => {
    feeProfileSchema.parse({
      fixedPerTransaction: 0.4,
      tier1Rate: 0.1235,
      tier1Cap: 2500,
      tier2Rate: 0.0235,
      trsFvfDiscount: 0.1,
    });
  });
  it("rejects rates outside [0, 1]", () => {
    expect(() =>
      feeProfileSchema.parse({
        fixedPerTransaction: 0.4,
        tier1Rate: 1.5,
        tier1Cap: 2500,
        tier2Rate: 0.0235,
        trsFvfDiscount: 0.1,
      }),
    ).toThrow();
  });
  it("rejects negative fixed fee", () => {
    expect(() =>
      feeProfileSchema.parse({
        fixedPerTransaction: -0.1,
        tier1Rate: 0.1235,
        tier1Cap: 2500,
        tier2Rate: 0.0235,
        trsFvfDiscount: 0.1,
      }),
    ).toThrow();
  });
});

describe("ruleSetBodySchema", () => {
  const validBody = {
    rules: [{ name: "r1", when: { ratio_gte: 0.85 }, action: { type: "accept" } }],
    feeProfile: {
      fixedPerTransaction: 0.4,
      tier1Rate: 0.1235,
      tier1Cap: 2500,
      tier2Rate: 0.0235,
      trsFvfDiscount: 0.1,
    },
  };

  it("accepts a well-formed body", () => {
    ruleSetBodySchema.parse(validBody);
  });
  it("rejects empty rule arrays", () => {
    expect(() => ruleSetBodySchema.parse({ ...validBody, rules: [] })).toThrow();
  });
  it("rejects extra top-level keys", () => {
    expect(() => ruleSetBodySchema.parse({ ...validBody, extra: 1 })).toThrow();
  });
});

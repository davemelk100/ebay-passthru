import { describe, expect, it } from "vitest";
import {
  computeStat,
  evaluateOffer,
  extractGradeScore,
  normalizeGrader,
  type OfferContext,
  type Rule,
} from "../src/domain/evaluator.js";

function ctx(overrides: Partial<OfferContext> = {}): OfferContext {
  return {
    itemId: "ITEM-1",
    bestOfferId: "BO-1",
    offerPrice: 50,
    listingPrice: 100,
    quantity: 1,
    ...overrides,
  };
}

describe("computeStat", () => {
  const vals = [1, 2, 3, 4, 5];
  it("min/max", () => {
    expect(computeStat(vals, "min")).toBe(1);
    expect(computeStat(vals, "max")).toBe(5);
  });
  it("mean", () => {
    expect(computeStat(vals, "mean")).toBe(3);
  });
  it("median == p50", () => {
    expect(computeStat(vals, "median")).toBe(3);
    expect(computeStat(vals, "p50")).toBe(3);
  });
  it("quartiles", () => {
    expect(computeStat(vals, "p25")).toBe(2);
    expect(computeStat(vals, "p75")).toBe(4);
  });
  it("p90 interpolates between elements", () => {
    expect(computeStat(vals, "p90")).toBeCloseTo(4.6, 5);
  });
  it("returns NaN for empty input", () => {
    expect(computeStat([], "median")).toBeNaN();
  });
});

describe("normalizeGrader", () => {
  it.each([
    ["PSA 10", "PSA"],
    ["Professional Sports Authenticator", "PSA"],
    ["BGS 9.5", "BGS"],
    ["Beckett", "BGS"],
    ["SGC 8", "SGC"],
    ["Sportscard Guaranty", "SGC"],
    ["CSG", "CSG"],
    ["Certified Sports", "CSG"],
    ["HGA 9", "HGA"],
    ["CGC", "CGC"],
    ["ISA", "ISA"],
    ["Something Else", ""],
    [undefined, ""],
    [null, ""],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeGrader(input)).toBe(expected);
  });
});

describe("extractGradeScore", () => {
  it.each([
    ["10", 10],
    ["9.5", 9.5],
    ["Gem Mint 10", 10],
    ["PSA 9.5", 9.5],
  ])("extracts %s → %s", (input, expected) => {
    expect(extractGradeScore(input)).toBe(expected);
  });
  it("returns NaN for non-numeric input", () => {
    expect(extractGradeScore(undefined)).toBeNaN();
    expect(extractGradeScore("no digits here")).toBeNaN();
  });
});

describe("evaluateOffer — ratio conditions", () => {
  const acceptHigh: Rule = {
    name: "accept-high",
    when: { ratio_gte: 0.85 },
    action: { type: "accept" },
  };
  const declineLow: Rule = {
    name: "decline-low",
    when: { ratio_lt: 0.6 },
    action: { type: "decline" },
  };

  it("accepts when ratio meets ratio_gte", () => {
    const d = evaluateOffer([acceptHigh], ctx({ offerPrice: 85 }));
    expect(d).toMatchObject({ action: "accept", matchedRule: "accept-high" });
  });
  it("declines when ratio is below ratio_lt", () => {
    const d = evaluateOffer([declineLow], ctx({ offerPrice: 50 }));
    expect(d).toMatchObject({ action: "decline", matchedRule: "decline-low" });
  });
  it("returns no-match when no rule fires", () => {
    const d = evaluateOffer([acceptHigh, declineLow], ctx({ offerPrice: 70 }));
    expect(d).toEqual({ action: "no-match", reason: "No rule matched this offer." });
  });
  it("handles listingPrice = 0 without dividing by zero", () => {
    const d = evaluateOffer([declineLow], ctx({ listingPrice: 0, offerPrice: 100 }));
    // ratio defaults to 0 in this case → declineLow fires
    expect(d).toMatchObject({ action: "decline" });
  });
});

describe("evaluateOffer — first match wins", () => {
  const rules: Rule[] = [
    { name: "first", when: { ratio_gte: 0.5 }, action: { type: "accept" } },
    { name: "second", when: { ratio_gte: 0.5 }, action: { type: "decline" } },
  ];
  it("returns the first matching rule", () => {
    const d = evaluateOffer(rules, ctx({ offerPrice: 60 }));
    expect(d).toMatchObject({ action: "accept", matchedRule: "first" });
  });
});

describe("evaluateOffer — counter with stats", () => {
  const counterMedian: Rule = {
    name: "counter-median",
    when: { ratio_gte: 0.4 },
    action: { type: "counter", price: { stat: "median", from: "comps" } },
  };

  it("counters at the comp median, rounded to cents", () => {
    const d = evaluateOffer(
      [counterMedian],
      ctx({ offerPrice: 50, comps: [18.5, 19.99, 20, 21, 22.105] }),
    );
    expect(d.action).toBe("counter");
    if (d.action === "counter") {
      expect(d.counterPrice).toBe(20);
      expect(d.counterQuantity).toBe(1);
      expect(d.priceSource.stat).toBe("median");
      expect(d.priceSource.usedFallback).toBeUndefined();
    }
  });

  it("uses fallback when comps are empty and fallback is set", () => {
    const counterWithFallback: Rule = {
      name: "counter-fallback",
      when: { ratio_gte: 0.4 },
      action: { type: "counter", price: { stat: "median", from: "comps", fallback: 75 } },
    };
    const d = evaluateOffer([counterWithFallback], ctx({ offerPrice: 50, comps: [] }));
    if (d.action === "counter") {
      expect(d.counterPrice).toBe(75);
      expect(d.priceSource.usedFallback).toBe(true);
    } else {
      expect.fail(`expected counter, got ${d.action}`);
    }
  });

  it("falls back to listingPrice when comps empty and no fallback", () => {
    const d = evaluateOffer(
      [counterMedian],
      ctx({ offerPrice: 50, listingPrice: 100, comps: [] }),
    );
    if (d.action === "counter") {
      expect(d.counterPrice).toBe(100);
      expect(d.priceSource.usedFallback).toBe(true);
    } else {
      expect.fail(`expected counter, got ${d.action}`);
    }
  });

  it("respects an absolute number as the counter price", () => {
    const r: Rule = {
      name: "counter-flat",
      when: { ratio_gte: 0 },
      action: { type: "counter", price: 42.5 },
    };
    const d = evaluateOffer([r], ctx({ offerPrice: 10 }));
    if (d.action === "counter") {
      expect(d.counterPrice).toBe(42.5);
      expect(d.priceSource.stat).toBeUndefined();
    } else {
      expect.fail(`expected counter, got ${d.action}`);
    }
  });

  it("respects an explicit counterQuantity override", () => {
    const r: Rule = {
      name: "counter-qty",
      when: { ratio_gte: 0 },
      action: { type: "counter", price: 10, quantity: 5 },
    };
    const d = evaluateOffer([r], ctx({ quantity: 1 }));
    if (d.action === "counter") {
      expect(d.counterQuantity).toBe(5);
    } else {
      expect.fail(`expected counter, got ${d.action}`);
    }
  });
});

describe("evaluateOffer — grade conditions", () => {
  it("matches is_graded=true only when there's a numeric grade > 0", () => {
    const r: Rule = {
      name: "graded-decline",
      when: { is_graded: true, ratio_lt: 0.7 },
      action: { type: "decline" },
    };
    expect(
      evaluateOffer([r], ctx({ offerPrice: 50, grade: { score: 9 } })).action,
    ).toBe("decline");
    expect(evaluateOffer([r], ctx({ offerPrice: 50 })).action).toBe("no-match");
  });

  it("respects grade_gte and grader_in", () => {
    const r: Rule = {
      name: "psa10-hold",
      when: { grader_in: ["PSA"], grade_gte: 10, ratio_lt: 1 },
      action: { type: "decline" },
    };
    expect(
      evaluateOffer(
        [r],
        ctx({ offerPrice: 50, grade: { company: "PSA", score: 10 } }),
      ).action,
    ).toBe("decline");
    expect(
      evaluateOffer(
        [r],
        ctx({ offerPrice: 50, grade: { company: "BGS", score: 10 } }),
      ).action,
    ).toBe("no-match");
    expect(
      evaluateOffer(
        [r],
        ctx({ offerPrice: 50, grade: { company: "PSA", score: 9 } }),
      ).action,
    ).toBe("no-match");
  });
});

describe("evaluateOffer — comps_min_count", () => {
  const counter: Rule = {
    name: "counter-with-comps",
    when: { ratio_gte: 0.4, comps_min_count: 3 },
    action: { type: "counter", price: { stat: "median", from: "comps", fallback: 0 } },
  };
  it("fires when comps meet the minimum", () => {
    expect(evaluateOffer([counter], ctx({ comps: [1, 2, 3] })).action).toBe("counter");
  });
  it("skips when comps fall short", () => {
    expect(evaluateOffer([counter], ctx({ comps: [1] })).action).toBe("no-match");
    expect(evaluateOffer([counter], ctx({ comps: undefined })).action).toBe("no-match");
  });
});

import { describe, it, expect } from "vitest";
import { computeFees, LEGACY_CARDZ_DEFAULTS } from "../src/domain/fees.js";

describe("computeFees", () => {
  it("uses tier 1 only when gross is below the cap", () => {
    // gross=100 → FVF = 100 * 0.1235 = 12.35 → after TRS = 12.35 * 0.9 = 11.115
    const { fvfRaw, fvfAfterTrs, fixedFee, feesTotal, estimatedNet } = computeFees(100);
    expect(fvfRaw).toBeCloseTo(12.35, 5);
    expect(fvfAfterTrs).toBeCloseTo(11.115, 5);
    expect(fixedFee).toBe(0.4);
    expect(feesTotal).toBeCloseTo(11.515, 5);
    expect(estimatedNet).toBeCloseTo(88.485, 5);
  });

  it("splits across both tiers when gross exceeds the cap", () => {
    // gross=5000
    //   tier1 portion = 2500 * 0.1235 = 308.75
    //   tier2 portion = 2500 * 0.0235 =  58.75
    //   fvfRaw                       = 367.50
    //   after TRS (10% off)          = 330.75
    //   fees total (+ $0.40)         = 331.15
    //   estimatedNet                 = 5000 - 331.15 = 4668.85
    const r = computeFees(5000);
    expect(r.fvfRaw).toBeCloseTo(367.5, 5);
    expect(r.fvfAfterTrs).toBeCloseTo(330.75, 5);
    expect(r.feesTotal).toBeCloseTo(331.15, 5);
    expect(r.estimatedNet).toBeCloseTo(4668.85, 5);
  });

  it("handles gross exactly equal to the cap", () => {
    // No tier2 spill, full tier1 only
    const r = computeFees(2500);
    expect(r.fvfRaw).toBeCloseTo(308.75, 5);
    expect(r.fvfAfterTrs).toBeCloseTo(277.875, 5);
  });

  it("handles zero gross — only the fixed fee, net goes negative", () => {
    const r = computeFees(0);
    expect(r.fvfRaw).toBe(0);
    expect(r.fvfAfterTrs).toBe(0);
    expect(r.feesTotal).toBe(0.4);
    expect(r.estimatedNet).toBe(-0.4);
  });

  it("rejects invalid gross values", () => {
    expect(() => computeFees(-1)).toThrowError(/non-negative/);
    expect(() => computeFees(Number.NaN)).toThrowError(/non-negative/);
    expect(() => computeFees(Number.POSITIVE_INFINITY)).toThrowError(/non-negative/);
  });

  it("respects an overridden fee profile", () => {
    const r = computeFees(1000, {
      ...LEGACY_CARDZ_DEFAULTS,
      tier1Rate: 0.1,
      trsFvfDiscount: 0, // no TRS discount
    });
    // 1000 * 0.10 = 100; no TRS discount; + 0.40 fixed = 100.40 fees
    expect(r.fvfRaw).toBeCloseTo(100, 5);
    expect(r.fvfAfterTrs).toBeCloseTo(100, 5);
    expect(r.estimatedNet).toBeCloseTo(899.6, 5);
  });
});

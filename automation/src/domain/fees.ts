// Fee model for Legacy Cardz. All knobs configurable — the profile that runs
// at any moment is whatever the active published rule_set carries in
// `fee_profile`. The defaults here are the v0 seed.
//
// Numbers from the spec:
//   - $0.40 fixed per transaction
//   - 12.35% FVF on the portion of gross up to $2,500
//   -  2.35% FVF on the portion above $2,500
//   - 10% TRS discount on the FVF amount (not the fixed fee)

export interface FeeProfile {
  fixedPerTransaction: number;
  tier1Rate: number;
  tier1Cap: number;
  tier2Rate: number;
  trsFvfDiscount: number;
}

export const LEGACY_CARDZ_DEFAULTS: FeeProfile = {
  fixedPerTransaction: 0.4,
  tier1Rate: 0.1235,
  tier1Cap: 2500,
  tier2Rate: 0.0235,
  trsFvfDiscount: 0.1,
};

export interface FeeBreakdown {
  /** Pre-TRS final-value-fee amount (sum of both tier portions). */
  fvfRaw: number;
  /** FVF after the TRS discount is applied. */
  fvfAfterTrs: number;
  /** Flat per-transaction fee (passes through; not affected by TRS). */
  fixedFee: number;
  /** Sum of fees the seller pays. */
  feesTotal: number;
  /** Gross minus feesTotal — what hits the seller's payout. */
  estimatedNet: number;
}

export function computeFees(gross: number, profile: FeeProfile = LEGACY_CARDZ_DEFAULTS): FeeBreakdown {
  if (!Number.isFinite(gross) || gross < 0) {
    throw new Error(`gross must be a non-negative number, got ${gross}`);
  }
  const tier1Portion = Math.min(gross, profile.tier1Cap);
  const tier2Portion = Math.max(0, gross - profile.tier1Cap);
  const fvfRaw = tier1Portion * profile.tier1Rate + tier2Portion * profile.tier2Rate;
  const fvfAfterTrs = fvfRaw * (1 - profile.trsFvfDiscount);
  const fixedFee = profile.fixedPerTransaction;
  const feesTotal = fixedFee + fvfAfterTrs;
  const estimatedNet = gross - feesTotal;
  return { fvfRaw, fvfAfterTrs, fixedFee, feesTotal, estimatedNet };
}

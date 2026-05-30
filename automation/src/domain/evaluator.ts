// Counter-bid rule engine. Ported from lib/counter-bid.ts in the parent
// repo. No I/O — `loadRules` is intentionally removed; rules now arrive via
// the pipeline, which loads the active published rule_set from Postgres.

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface Condition {
  // Ratio of offerPrice to listingPrice. ratio = offer / listing.
  ratio_gte?: number;
  ratio_gt?: number;
  ratio_lte?: number;
  ratio_lt?: number;
  // Absolute offer price thresholds.
  offer_gte?: number;
  offer_lt?: number;
  // Comp-count gate so "use median of comps" rules don't fire on sparse data.
  comps_min_count?: number;
  // Graded-card knobs — populated when the inventory side passed a grade.
  is_graded?: boolean;
  grade_gte?: number;
  grade_lt?: number;
  grader_in?: string[];
}

export type StatName = "median" | "mean" | "min" | "max" | "p25" | "p50" | "p75" | "p90";

export interface StatRef {
  stat: StatName;
  from: "comps";
  fallback?: number;
}

export type PriceExpr = number | StatRef;

export interface AcceptAction {
  type: "accept";
  message?: string;
}
export interface DeclineAction {
  type: "decline";
  message?: string;
}
export interface CounterAction {
  type: "counter";
  price: PriceExpr;
  quantity?: number;
  message?: string;
}

export type Action = AcceptAction | DeclineAction | CounterAction;

export interface Rule {
  name: string;
  when: Condition;
  action: Action;
}

export interface OfferContext {
  itemId: string;
  bestOfferId: string;
  buyerUserId?: string;
  offerPrice: number;
  listingPrice: number;
  quantity: number;
  currency?: string;
  comps?: number[];
  grade?: {
    company?: string;
    score?: number;
    raw?: string;
  };
}

export type Decision =
  | { action: "accept"; matchedRule: string; message?: string }
  | { action: "decline"; matchedRule: string; message?: string }
  | {
      action: "counter";
      matchedRule: string;
      counterPrice: number;
      counterQuantity: number;
      message?: string;
      priceSource: { stat?: StatName; usedFallback?: boolean; value: number };
    }
  | { action: "no-match"; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// Statistics
// ─────────────────────────────────────────────────────────────────────────────

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function computeStat(values: number[], stat: StatName): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  switch (stat) {
    case "min":
      return sorted[0]!;
    case "max":
      return sorted[sorted.length - 1]!;
    case "mean":
      return values.reduce((s, v) => s + v, 0) / values.length;
    case "median":
    case "p50":
      return quantile(sorted, 0.5);
    case "p25":
      return quantile(sorted, 0.25);
    case "p75":
      return quantile(sorted, 0.75);
    case "p90":
      return quantile(sorted, 0.9);
  }
}

function resolvePrice(
  expr: PriceExpr,
  ctx: OfferContext,
): { value: number; stat?: StatName; usedFallback?: boolean } {
  if (typeof expr === "number") return { value: expr };
  const comps = ctx.comps ?? [];
  if (comps.length === 0) {
    if (expr.fallback !== undefined) {
      return { value: expr.fallback, usedFallback: true, stat: expr.stat };
    }
    // Last-resort fallback: the listing price. Documented in the rule schema
    // so authors aren't surprised by counters at full asking.
    return { value: ctx.listingPrice, usedFallback: true, stat: expr.stat };
  }
  const value = computeStat(comps, expr.stat);
  return { value, stat: expr.stat };
}

// ─────────────────────────────────────────────────────────────────────────────
// Condition matching
// ─────────────────────────────────────────────────────────────────────────────

function matches(when: Condition, ctx: OfferContext): boolean {
  const ratio = ctx.listingPrice > 0 ? ctx.offerPrice / ctx.listingPrice : 0;
  if (when.ratio_gte !== undefined && !(ratio >= when.ratio_gte)) return false;
  if (when.ratio_gt !== undefined && !(ratio > when.ratio_gt)) return false;
  if (when.ratio_lte !== undefined && !(ratio <= when.ratio_lte)) return false;
  if (when.ratio_lt !== undefined && !(ratio < when.ratio_lt)) return false;
  if (when.offer_gte !== undefined && !(ctx.offerPrice >= when.offer_gte)) return false;
  if (when.offer_lt !== undefined && !(ctx.offerPrice < when.offer_lt)) return false;
  if (when.comps_min_count !== undefined && (ctx.comps?.length ?? 0) < when.comps_min_count) {
    return false;
  }
  const score = ctx.grade?.score;
  const hasGrade = typeof score === "number" && score > 0;
  if (when.is_graded === true && !hasGrade) return false;
  if (when.is_graded === false && hasGrade) return false;
  if (when.grade_gte !== undefined && !(hasGrade && score! >= when.grade_gte)) return false;
  if (when.grade_lt !== undefined && !(hasGrade && score! < when.grade_lt)) return false;
  if (when.grader_in !== undefined) {
    const c = ctx.grade?.company ?? "";
    if (!when.grader_in.includes(c)) return false;
  }
  return true;
}

// Normalize a grading company string from eBay's "Professional Grader" /
// "Grading Service" / "Certification" item specifics into a short code.
export function normalizeGrader(input: string | undefined | null): string {
  if (!input) return "";
  const s = String(input).toUpperCase();
  if (s.includes("PSA") || s.includes("PROFESSIONAL SPORTS")) return "PSA";
  if (s.includes("BGS") || s.includes("BECKETT")) return "BGS";
  if (s.includes("SGC") || s.includes("SPORTSCARD GUARANTY")) return "SGC";
  if (s.includes("CSG") || s.includes("CERTIFIED SPORTS")) return "CSG";
  if (s.includes("HGA") || s.includes("HYBRID GRADING")) return "HGA";
  if (s.includes("ISA")) return "ISA";
  if (s.includes("CGC")) return "CGC";
  return "";
}

// Extract a numeric grade from item specifics. Handles "10", "9.5", "Gem Mint 10",
// "PSA 10", etc. Returns NaN if no number found.
export function extractGradeScore(raw: string | undefined | null): number {
  if (!raw) return Number.NaN;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!m) return Number.NaN;
  const n = Number.parseFloat(m[1]!);
  return Number.isFinite(n) ? n : Number.NaN;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateOffer(rules: Rule[], ctx: OfferContext): Decision {
  for (const rule of rules) {
    if (!matches(rule.when, ctx)) continue;
    const action = rule.action;
    if (action.type === "accept") {
      return { action: "accept", matchedRule: rule.name, message: action.message };
    }
    if (action.type === "decline") {
      return { action: "decline", matchedRule: rule.name, message: action.message };
    }
    const priceInfo = resolvePrice(action.price, ctx);
    const rounded = Math.round(priceInfo.value * 100) / 100;
    return {
      action: "counter",
      matchedRule: rule.name,
      counterPrice: rounded,
      counterQuantity: action.quantity ?? ctx.quantity ?? 1,
      message: action.message,
      priceSource: {
        stat: priceInfo.stat,
        usedFallback: priceInfo.usedFallback,
        value: rounded,
      },
    };
  }
  return { action: "no-match", reason: "No rule matched this offer." };
}

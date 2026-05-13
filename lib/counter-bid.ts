import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ---------- Rule format ----------
//
// Rules live in lib/counter-bid-rules.json. They're evaluated top-to-bottom
// per offer; the first rule whose `when` clause matches wins. Each rule
// declares an action (accept / decline / counter) plus, for counter offers,
// a price expression that can reference statistical comps supplied by the
// caller (median / mean / p25 / p50 / p75 / p90 / min / max).
//
// Example:
//   {
//     "name": "accept-high-offers",
//     "when": { "ratio_gte": 0.85 },
//     "action": { "type": "accept" }
//   }

export interface Condition {
  ratio_gte?: number; // offerPrice / listingPrice
  ratio_gt?: number;
  ratio_lte?: number;
  ratio_lt?: number;
  offer_gte?: number;
  offer_lt?: number;
  comps_min_count?: number;

  // Graded card support — populated when GetItem returns a Grade item-specific.
  is_graded?: boolean; // true requires a numeric grade > 0
  grade_gte?: number; // e.g. 9 (PSA 9 or better)
  grade_lt?: number;
  grader_in?: string[]; // normalized codes, e.g. ["PSA", "BGS", "SGC", "CSG"]
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

export interface RuleFile {
  rules: Rule[];
}

// ---------- Inputs / outputs ----------

export interface OfferContext {
  itemId: string;
  bestOfferId: string;
  buyerUserId?: string;
  offerPrice: number;
  listingPrice: number;
  quantity: number;
  comps?: number[];
  grade?: {
    company?: string; // normalized: PSA, BGS, SGC, CSG, HGA, or "" if unknown
    score?: number; // numeric grade extracted from item specifics, e.g. 9, 9.5, 10
    raw?: string; // original label from eBay, e.g. "PSA 10 Gem Mint"
  };
}

export type Decision =
  | {
      action: "accept";
      matchedRule: string;
      message?: string;
    }
  | {
      action: "decline";
      matchedRule: string;
      message?: string;
    }
  | {
      action: "counter";
      matchedRule: string;
      counterPrice: number;
      counterQuantity: number;
      message?: string;
      priceSource: { stat?: StatName; usedFallback?: boolean; value: number };
    }
  | { action: "no-match"; reason: string };

// ---------- Loader ----------

let cachedRules: RuleFile | null = null;
let cachedAtMs = 0;
const CACHE_TTL_MS = 5_000; // re-read on every request when developing

export async function loadRules(): Promise<RuleFile> {
  if (cachedRules && Date.now() - cachedAtMs < CACHE_TTL_MS) return cachedRules;
  const path = resolve(process.cwd(), "lib/counter-bid-rules.json");
  const text = await readFile(path, "utf8");
  cachedRules = JSON.parse(text) as RuleFile;
  cachedAtMs = Date.now();
  return cachedRules;
}

// ---------- Stats ----------

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function computeStat(values: number[], stat: StatName): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  switch (stat) {
    case "min":
      return sorted[0];
    case "max":
      return sorted[sorted.length - 1];
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

function resolvePrice(expr: PriceExpr, ctx: OfferContext): {
  value: number;
  stat?: StatName;
  usedFallback?: boolean;
} {
  if (typeof expr === "number") return { value: expr };
  const comps = ctx.comps ?? [];
  if (comps.length === 0) {
    if (expr.fallback !== undefined) return { value: expr.fallback, usedFallback: true, stat: expr.stat };
    return { value: ctx.listingPrice, usedFallback: true, stat: expr.stat };
  }
  const value = computeStat(comps, expr.stat);
  return { value, stat: expr.stat };
}

// ---------- Conditions ----------

function matches(when: Condition, ctx: OfferContext): boolean {
  const ratio = ctx.listingPrice > 0 ? ctx.offerPrice / ctx.listingPrice : 0;
  if (when.ratio_gte !== undefined && !(ratio >= when.ratio_gte)) return false;
  if (when.ratio_gt !== undefined && !(ratio > when.ratio_gt)) return false;
  if (when.ratio_lte !== undefined && !(ratio <= when.ratio_lte)) return false;
  if (when.ratio_lt !== undefined && !(ratio < when.ratio_lt)) return false;
  if (when.offer_gte !== undefined && !(ctx.offerPrice >= when.offer_gte)) return false;
  if (when.offer_lt !== undefined && !(ctx.offerPrice < when.offer_lt)) return false;
  if (when.comps_min_count !== undefined && (ctx.comps?.length ?? 0) < when.comps_min_count) return false;
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
  if (!raw) return NaN;
  const m = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!m) return NaN;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : NaN;
}

// ---------- Evaluator ----------

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
    // counter
    const priceInfo = resolvePrice(action.price, ctx);
    const rounded = Math.round(priceInfo.value * 100) / 100;
    return {
      action: "counter",
      matchedRule: rule.name,
      counterPrice: rounded,
      counterQuantity: action.quantity ?? ctx.quantity ?? 1,
      message: action.message,
      priceSource: { stat: priceInfo.stat, usedFallback: priceInfo.usedFallback, value: rounded },
    };
  }
  return { action: "no-match", reason: "No rule matched this offer." };
}

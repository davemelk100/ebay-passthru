// zod runtime validation that mirrors the TypeScript types in evaluator.ts
// and fees.ts. The admin POST/PATCH handlers run incoming JSON through these
// before it lands in Postgres so a bad payload can't poison the runtime.
//
// .strict() everywhere — unknown keys are an error, not silently dropped.

import { z } from "zod";

export const conditionSchema = z
  .object({
    ratio_gte: z.number().optional(),
    ratio_gt: z.number().optional(),
    ratio_lte: z.number().optional(),
    ratio_lt: z.number().optional(),
    offer_gte: z.number().nonnegative().optional(),
    offer_lt: z.number().nonnegative().optional(),
    comps_min_count: z.number().int().nonnegative().optional(),
    is_graded: z.boolean().optional(),
    grade_gte: z.number().optional(),
    grade_lt: z.number().optional(),
    grader_in: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const statNameSchema = z.enum([
  "median",
  "mean",
  "min",
  "max",
  "p25",
  "p50",
  "p75",
  "p90",
]);

export const statRefSchema = z
  .object({
    stat: statNameSchema,
    from: z.literal("comps"),
    fallback: z.number().optional(),
  })
  .strict();

export const priceExprSchema = z.union([z.number(), statRefSchema]);

export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("accept"),
      message: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("decline"),
      message: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("counter"),
      price: priceExprSchema,
      quantity: z.number().int().positive().optional(),
      message: z.string().max(2000).optional(),
    })
    .strict(),
]);

export const ruleSchema = z
  .object({
    name: z.string().min(1).max(200),
    when: conditionSchema,
    action: actionSchema,
  })
  .strict();

export const feeProfileSchema = z
  .object({
    fixedPerTransaction: z.number().nonnegative(),
    tier1Rate: z.number().nonnegative().max(1),
    tier1Cap: z.number().nonnegative(),
    tier2Rate: z.number().nonnegative().max(1),
    trsFvfDiscount: z.number().nonnegative().max(1),
  })
  .strict();

// The body of POST /admin/rules and PATCH /admin/rules/:id. Workers read
// rules + feeProfile together from the published row, so they're always
// edited together — there's no separate "patch just the fees" endpoint.
export const ruleSetBodySchema = z
  .object({
    rules: z.array(ruleSchema).min(1, "at least one rule required"),
    feeProfile: feeProfileSchema,
  })
  .strict();

export type ConditionInput = z.infer<typeof conditionSchema>;
export type ActionInput = z.infer<typeof actionSchema>;
export type RuleInput = z.infer<typeof ruleSchema>;
export type FeeProfileInput = z.infer<typeof feeProfileSchema>;
export type RuleSetBody = z.infer<typeof ruleSetBodySchema>;

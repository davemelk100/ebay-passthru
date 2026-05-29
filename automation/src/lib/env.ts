import { z } from "zod";

// Single source of truth for environment configuration. Parsed once at module
// load — production deploys fail fast if anything's missing rather than
// crashing on the first request that touches the bad var.
const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8080),
    NODE_ENV: z
      .enum(["development", "staging", "production", "test"])
      .default("development"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    EBAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    EBAY_APP_ID: z.string().min(1),
    EBAY_DEV_ID: z.string().min(1),
    EBAY_CERT_ID: z.string().min(1),
    EBAY_REFRESH_TOKEN: z.string().optional(),
    EBAY_AUTH_TOKEN: z.string().optional(),
    EBAY_SITE_ID: z.string().default("0"),
    EBAY_COMPAT_LEVEL: z.string().default("1193"),

    ADMIN_BEARER_TOKEN: z.string().optional(),
  })
  .refine((v) => v.EBAY_REFRESH_TOKEN || v.EBAY_AUTH_TOKEN, {
    message: "Either EBAY_REFRESH_TOKEN or EBAY_AUTH_TOKEN must be set",
    path: ["EBAY_REFRESH_TOKEN"],
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

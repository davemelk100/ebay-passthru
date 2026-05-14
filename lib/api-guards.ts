import "server-only";
import { NextResponse } from "next/server";
import { configIssues, readConfig, type EbayConfig } from "@/lib/ebay";

const MISSING_CREDS_HINT =
  "Copy .env.local.example to .env.local and fill in your keys.";

export type ConfigGuardResult =
  | { cfg: EbayConfig; response?: undefined }
  | { cfg?: undefined; response: NextResponse };

export interface ConfigGuardOptions {
  // Include `ok: false` in the 412 body (some routes return ok-flag responses).
  okFlag?: boolean;
  // Include the .env.local hint in the 412 body.
  hint?: boolean;
}

export function requireEbayConfig(opts: ConfigGuardOptions = {}): ConfigGuardResult {
  const cfg = readConfig();
  const missing = configIssues(cfg);
  if (missing.length === 0) return { cfg };
  const body: Record<string, unknown> = {
    error: "Missing eBay credentials.",
    missing,
  };
  if (opts.okFlag) body.ok = false;
  if (opts.hint) body.hint = MISSING_CREDS_HINT;
  return { response: NextResponse.json(body, { status: 412 }) };
}

export interface ProductionBlockOptions {
  // True when the specific call being made is destructive (so it needs the guard).
  blocked: boolean;
  allowProduction: boolean;
  error: string;
  hint?: string;
  details?: Record<string, unknown>;
  okFlag?: boolean;
}

export function blockIfProduction(
  cfg: EbayConfig,
  opts: ProductionBlockOptions,
): NextResponse | null {
  if (cfg.env !== "production" || !opts.blocked || opts.allowProduction) return null;
  const body: Record<string, unknown> = { error: opts.error };
  if (opts.okFlag) body.ok = false;
  if (opts.hint) body.hint = opts.hint;
  if (opts.details) Object.assign(body, opts.details);
  return NextResponse.json(body, { status: 412 });
}

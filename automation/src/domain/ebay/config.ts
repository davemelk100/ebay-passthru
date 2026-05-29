import { env } from "../../lib/env.js";

export type EbayEnv = "sandbox" | "production";

export interface EbayConfig {
  env: EbayEnv;
  appId: string;
  devId: string;
  certId: string;
  authToken: string;
  refreshToken: string;
  siteId: string;
  compatLevel: string;
}

// Build an EbayConfig from the validated env. Tests can construct their own
// EbayConfig literal to exercise edge cases without touching process.env.
export function configFromEnv(): EbayConfig {
  return {
    env: env.EBAY_ENV,
    appId: env.EBAY_APP_ID,
    devId: env.EBAY_DEV_ID,
    certId: env.EBAY_CERT_ID,
    authToken: env.EBAY_AUTH_TOKEN ?? "",
    refreshToken: env.EBAY_REFRESH_TOKEN ?? "",
    siteId: env.EBAY_SITE_ID,
    compatLevel: env.EBAY_COMPAT_LEVEL,
  };
}

// Returns the list of *missing* env vars so the caller can surface a 412
// with an actionable error message rather than crashing on the first eBay
// call. Mirrors the existing app's behavior.
export function configIssues(cfg: EbayConfig): string[] {
  const missing: string[] = [];
  if (!cfg.appId) missing.push("EBAY_APP_ID");
  if (!cfg.devId) missing.push("EBAY_DEV_ID");
  if (!cfg.certId) missing.push("EBAY_CERT_ID");
  if (!cfg.authToken && !cfg.refreshToken) {
    missing.push("EBAY_AUTH_TOKEN or EBAY_REFRESH_TOKEN");
  }
  return missing;
}

export function endpointFor(env: EbayEnv): string {
  return env === "production"
    ? "https://api.ebay.com/ws/api.dll"
    : "https://api.sandbox.ebay.com/ws/api.dll";
}

export function identityEndpoint(env: EbayEnv): string {
  return env === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
}

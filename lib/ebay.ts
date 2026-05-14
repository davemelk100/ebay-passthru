import "server-only";
import { XMLParser } from "fast-xml-parser";
import { curlRequest } from "./curl";
import { asArray } from "./ebay-xml";

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

export interface EbayCallResult {
  ok: boolean;
  status: number;
  ack?: string;
  errors: EbayError[];
  rawXml: string;
  parsed: unknown;
  endpoint: string;
  durationMs: number;
}

export interface EbayError {
  code?: string;
  shortMessage?: string;
  longMessage?: string;
  severity?: string;
}

export function readConfig(): EbayConfig {
  const env = (process.env.EBAY_ENV ?? "sandbox") as EbayEnv;
  return {
    env,
    appId: process.env.EBAY_APP_ID ?? "",
    devId: process.env.EBAY_DEV_ID ?? "",
    certId: process.env.EBAY_CERT_ID ?? "",
    authToken: process.env.EBAY_AUTH_TOKEN ?? "",
    refreshToken: process.env.EBAY_REFRESH_TOKEN ?? "",
    siteId: process.env.EBAY_SITE_ID ?? "0",
    compatLevel: process.env.EBAY_COMPAT_LEVEL ?? "1193",
  };
}

export function configIssues(cfg: EbayConfig): string[] {
  const missing: string[] = [];
  if (!cfg.appId) missing.push("EBAY_APP_ID");
  if (!cfg.devId) missing.push("EBAY_DEV_ID");
  if (!cfg.certId) missing.push("EBAY_CERT_ID");
  if (!cfg.authToken && !cfg.refreshToken) missing.push("EBAY_AUTH_TOKEN or EBAY_REFRESH_TOKEN");
  return missing;
}

function endpointFor(env: EbayEnv): string {
  return env === "production"
    ? "https://api.ebay.com/ws/api.dll"
    : "https://api.sandbox.ebay.com/ws/api.dll";
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
});

// Wraps a Trading API call body in the standard envelope.
// OAuth: token is sent via X-EBAY-API-IAF-TOKEN header, not inside the body.
export function buildRequestBody(callName: string, innerXml: string, _cfg: EbayConfig): string {
  const trimmed = innerXml.trim();
  const hasEnvelope = trimmed.includes(`<${callName}Request`);

  if (hasEnvelope) {
    return `<?xml version="1.0" encoding="utf-8"?>\n${trimmed}`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  ${trimmed}
</${callName}Request>`;
}

// Cached access token; refreshed automatically when expired/expiring.
let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let inflightRefresh: Promise<string> | null = null;

function identityEndpoint(env: EbayEnv): string {
  return env === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
}

async function refreshAccessToken(cfg: EbayConfig): Promise<string> {
  const basic = Buffer.from(`${cfg.appId}:${cfg.certId}`).toString("base64");
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cfg.refreshToken,
  }).toString();

  const { status, text } = await curlRequest(
    identityEndpoint(cfg.env),
    "POST",
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    form,
  );

  if (status !== 200) {
    throw new Error(`Refresh token exchange failed: HTTP ${status} ${text}`);
  }
  const json = JSON.parse(text) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return json.access_token;
}

export async function getAccessToken(cfg: EbayConfig): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }
  if (!cfg.refreshToken) {
    // No refresh token configured — fall back to the static EBAY_AUTH_TOKEN.
    if (!cfg.authToken) throw new Error("No EBAY_AUTH_TOKEN or EBAY_REFRESH_TOKEN configured.");
    return cfg.authToken;
  }
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = refreshAccessToken(cfg).finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

export async function callTradingApi(
  callName: string,
  innerXml: string,
  cfg: EbayConfig,
): Promise<EbayCallResult> {
  const endpoint = endpointFor(cfg.env);
  const body = buildRequestBody(callName, innerXml, cfg);
  const started = Date.now();

  const accessToken = await getAccessToken(cfg);

  const { status, text: rawXml } = await curlRequest(
    endpoint,
    "POST",
    {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": cfg.compatLevel,
      "X-EBAY-API-DEV-NAME": cfg.devId,
      "X-EBAY-API-APP-NAME": cfg.appId,
      "X-EBAY-API-CERT-NAME": cfg.certId,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": cfg.siteId,
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body,
  );

  const durationMs = Date.now() - started;
  let parsed: unknown = null;
  try {
    parsed = parser.parse(rawXml);
  } catch {
    parsed = null;
  }

  const respKey = `${callName}Response`;
  const resp = (parsed as Record<string, unknown> | null)?.[respKey] as
    | Record<string, unknown>
    | undefined;
  const ack = typeof resp?.Ack === "string" ? resp.Ack : undefined;
  const errors = extractErrors(resp);

  return {
    ok: status >= 200 && status < 300 && (ack === "Success" || ack === "Warning"),
    status,
    ack,
    errors,
    rawXml,
    parsed,
    endpoint,
    durationMs,
  };
}

function extractErrors(resp: Record<string, unknown> | undefined): EbayError[] {
  if (!resp) return [];
  return asArray<Record<string, unknown>>(resp.Errors).map((obj) => ({
    code: stringOrUndefined(obj.ErrorCode),
    shortMessage: stringOrUndefined(obj.ShortMessage),
    longMessage: stringOrUndefined(obj.LongMessage),
    severity: stringOrUndefined(obj.SeverityCode),
  }));
}

function stringOrUndefined(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}


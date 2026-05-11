import "server-only";
import { XMLParser } from "fast-xml-parser";

export type EbayEnv = "sandbox" | "production";

export interface EbayConfig {
  env: EbayEnv;
  appId: string;
  devId: string;
  certId: string;
  authToken: string;
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
    siteId: process.env.EBAY_SITE_ID ?? "0",
    compatLevel: process.env.EBAY_COMPAT_LEVEL ?? "1193",
  };
}

export function configIssues(cfg: EbayConfig): string[] {
  const missing: string[] = [];
  if (!cfg.appId) missing.push("EBAY_APP_ID");
  if (!cfg.devId) missing.push("EBAY_DEV_ID");
  if (!cfg.certId) missing.push("EBAY_CERT_ID");
  if (!cfg.authToken) missing.push("EBAY_AUTH_TOKEN");
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

// Wraps a Trading API call body in the standard envelope, injecting the user auth token.
export function buildRequestBody(callName: string, innerXml: string, cfg: EbayConfig): string {
  const trimmed = innerXml.trim();
  // If caller already supplied a full <CallNameRequest>...</CallNameRequest>, just inject the token.
  const hasEnvelope = trimmed.includes(`<${callName}Request`);
  const credentialBlock = `<RequesterCredentials><eBayAuthToken>${cfg.authToken}</eBayAuthToken></RequesterCredentials>`;

  if (hasEnvelope) {
    if (trimmed.includes("<RequesterCredentials>")) {
      return `<?xml version="1.0" encoding="utf-8"?>\n${trimmed}`;
    }
    // inject credentials right after the opening request tag
    const injected = trimmed.replace(
      new RegExp(`(<${callName}Request[^>]*>)`),
      `$1\n  ${credentialBlock}`,
    );
    return `<?xml version="1.0" encoding="utf-8"?>\n${injected}`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  ${credentialBlock}
  ${trimmed}
</${callName}Request>`;
}

export async function callTradingApi(
  callName: string,
  innerXml: string,
  cfg: EbayConfig,
): Promise<EbayCallResult> {
  const endpoint = endpointFor(cfg.env);
  const body = buildRequestBody(callName, innerXml, cfg);
  const started = Date.now();

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": cfg.compatLevel,
      "X-EBAY-API-DEV-NAME": cfg.devId,
      "X-EBAY-API-APP-NAME": cfg.appId,
      "X-EBAY-API-CERT-NAME": cfg.certId,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": cfg.siteId,
    },
    body,
    cache: "no-store",
  });

  const rawXml = await res.text();
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
    ok: res.ok && (ack === "Success" || ack === "Warning"),
    status: res.status,
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
  const raw = resp.Errors;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((e) => {
    const obj = e as Record<string, unknown>;
    return {
      code: stringOrUndefined(obj.ErrorCode),
      shortMessage: stringOrUndefined(obj.ShortMessage),
      longMessage: stringOrUndefined(obj.LongMessage),
      severity: stringOrUndefined(obj.SeverityCode),
    };
  });
}

function stringOrUndefined(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}


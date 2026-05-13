import "server-only";
import { execFile } from "node:child_process";
import { getAccessToken, type EbayConfig } from "./ebay";

// Modern Sell REST API base URLs.
// All Sell APIs (Inventory, Account, Fulfillment, Marketing, Negotiation, Finances) hang off these.
function sellBase(env: EbayConfig["env"]): string {
  return env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

export interface SellCallResult {
  ok: boolean;
  status: number;
  body: unknown;
  rawText: string;
  durationMs: number;
  endpoint: string;
}

export type SellMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

// Mirrors curlPost in lib/ebay.ts, but supports arbitrary HTTP methods and
// returns a parsed JSON body (or raw text if non-JSON). Sell APIs accept the
// same OAuth access token via Authorization: Bearer.
function curlRequest(
  url: string,
  method: SellMethod,
  headers: Record<string, string>,
  body: string | null,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const STATUS_MARKER = "\n__EBAY_HTTP_STATUS__:";
    const args = ["-sS", "-X", method, "-w", `${STATUS_MARKER}%{http_code}`];
    for (const [k, v] of Object.entries(headers)) {
      args.push("-H", `${k}: ${v}`);
    }
    if (body !== null) {
      args.push("--data-binary", "@-");
    }
    args.push(url);

    const child = execFile(
      "curl",
      args,
      { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
      (err, stdout) => {
        if (err) return reject(err);
        const idx = stdout.lastIndexOf(STATUS_MARKER);
        if (idx < 0) return resolve({ status: 0, text: stdout });
        const status = Number.parseInt(stdout.slice(idx + STATUS_MARKER.length).trim(), 10);
        resolve({ status: Number.isFinite(status) ? status : 0, text: stdout.slice(0, idx) });
      },
    );
    if (body !== null && child.stdin) child.stdin.end(body);
    else if (child.stdin) child.stdin.end();
  });
}

export async function callSellApi(
  method: SellMethod,
  path: string,
  body: unknown,
  cfg: EbayConfig,
): Promise<SellCallResult> {
  const url = `${sellBase(cfg.env)}${path.startsWith("/") ? path : `/${path}`}`;
  const accessToken = await getAccessToken(cfg);
  const started = Date.now();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    // Most Sell APIs require this header for marketplace context.
    "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
  };
  const hasBody = body !== undefined && body !== null && method !== "GET" && method !== "DELETE";
  if (hasBody) headers["Content-Type"] = "application/json";

  const { status, text } = await curlRequest(
    url,
    method,
    headers,
    hasBody ? JSON.stringify(body) : null,
  );

  const durationMs = Date.now() - started;
  let parsed: unknown = text;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // leave as raw text
    }
  } else {
    parsed = null;
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    body: parsed,
    rawText: text,
    durationMs,
    endpoint: url,
  };
}

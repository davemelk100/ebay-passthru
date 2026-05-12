// One-shot helper to mint an eBay OAuth access + refresh token pair and write them to .env.local.
//
// Two-step flow:
//   Step 1 — Open the consent URL:
//     node scripts/ebay-oauth.mjs
//   This prints + opens the URL. Sign in as a sandbox user, click "Agree". Copy the resulting URL
//   from the browser's address bar.
//
//   Step 2 — Exchange the code:
//     node scripts/ebay-oauth.mjs '<paste-the-url-here>'
//   Tokens are exchanged and written to .env.local.

import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const ENV_PATH = new URL("../.env.local", import.meta.url);

function parseEnvLocal(text) {
  const map = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    } else {
      // Strip trailing inline comment on unquoted values.
      const hash = val.indexOf("#");
      if (hash >= 0) val = val.slice(0, hash).trim();
    }
    map.set(key, val);
  }
  return map;
}

function upsertEnvLocal(text, updates) {
  let out = text;
  for (const [key, value] of Object.entries(updates)) {
    const quoted = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(out)) {
      out = out.replace(re, quoted);
    } else {
      out = out.replace(/\s*$/, "") + `\n${quoted}\n`;
    }
  }
  return out;
}

const envText = readFileSync(ENV_PATH, "utf8");
const env = parseEnvLocal(envText);

const APP_ID = env.get("EBAY_APP_ID");
const CERT_ID = env.get("EBAY_CERT_ID");
const RU_NAME = env.get("EBAY_RU_NAME");
const EBAY_ENV = env.get("EBAY_ENV") ?? "sandbox";

const missing = [];
if (!APP_ID) missing.push("EBAY_APP_ID");
if (!CERT_ID) missing.push("EBAY_CERT_ID");
if (!RU_NAME) missing.push("EBAY_RU_NAME");
if (missing.length > 0) {
  console.error(`Missing required values in .env.local: ${missing.join(", ")}`);
  console.error(
    "EBAY_RU_NAME is the OAuth-enabled RuName from https://developer.ebay.com/my/auth (User Tokens tab).",
  );
  process.exit(1);
}

const isSandbox = EBAY_ENV !== "production";
const authHost = isSandbox ? "auth.sandbox.ebay.com" : "auth.ebay.com";
const apiHost = isSandbox ? "api.sandbox.ebay.com" : "api.ebay.com";

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
].join(" ");

const pastedUrl = process.argv[2];

if (!pastedUrl) {
  // Step 1: print and open the consent URL.
  const state = Math.random().toString(36).slice(2);
  const authUrl = new URL(`https://${authHost}/oauth2/authorize`);
  authUrl.searchParams.set("client_id", APP_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", RU_NAME);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "login");

  console.log(`\neBay OAuth helper — environment: ${EBAY_ENV}`);
  console.log(`App ID:  ${APP_ID}`);
  console.log(`RuName:  ${RU_NAME}\n`);
  console.log("Opening the consent URL in your browser…");
  console.log(`If it doesn't open, paste this into your browser manually:\n\n${authUrl.toString()}\n`);

  spawn("open", [authUrl.toString()], { stdio: "ignore", detached: true }).unref();

  console.log("After clicking 'Agree and Continue', copy the URL from the browser's address bar");
  console.log("and re-run this script with that URL as the argument:\n");
  console.log("  node scripts/ebay-oauth.mjs '<paste-the-url-here>'\n");
  process.exit(0);
}

// Step 2: exchange the auth code.
let code;
try {
  const u = new URL(pastedUrl.trim());
  code = u.searchParams.get("code");
} catch {
  console.error("Could not parse that as a URL.");
  process.exit(1);
}
if (!code) {
  console.error("No `code` query param found in the pasted URL.");
  process.exit(1);
}

console.log("\nExchanging authorization code for tokens…");

const tokenRes = await fetch(`https://${apiHost}/identity/v1/oauth2/token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${Buffer.from(`${APP_ID}:${CERT_ID}`).toString("base64")}`,
  },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: RU_NAME,
  }).toString(),
});

const tokenText = await tokenRes.text();
if (!tokenRes.ok) {
  console.error(`Token exchange failed (HTTP ${tokenRes.status}):\n${tokenText}`);
  process.exit(1);
}

const tokens = JSON.parse(tokenText);
if (!tokens.access_token || !tokens.refresh_token) {
  console.error("Token response missing access_token or refresh_token:");
  console.error(tokenText);
  process.exit(1);
}

const updated = upsertEnvLocal(envText, {
  EBAY_AUTH_TOKEN: tokens.access_token,
  EBAY_REFRESH_TOKEN: tokens.refresh_token,
  EBAY_RU_NAME: RU_NAME,
});
writeFileSync(ENV_PATH, updated);

console.log("\nTokens written to .env.local:");
console.log(`  EBAY_AUTH_TOKEN     (access)  expires in ${tokens.expires_in}s`);
console.log(`  EBAY_REFRESH_TOKEN  (refresh) expires in ${tokens.refresh_token_expires_in}s`);
console.log("\nRestart `npm run dev` to pick up the new tokens.");

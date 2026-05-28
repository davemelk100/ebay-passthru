// Registers (or unregisters) the production webhook URL with eBay so
// Platform Notifications fire on best-offer events.
//
// Usage:
//   node scripts/setup-notifications.mjs              # subscribe with default URL + events
//   node scripts/setup-notifications.mjs disable      # unsubscribe (events off)
//   node scripts/setup-notifications.mjs status       # print current preferences
//
// Override the webhook URL via WEBHOOK_URL env var if not deploying to
// ebay-passthru.vercel.app.

import { readFileSync } from "node:fs";

const ENV_PATH = new URL("../.env.local", import.meta.url);
const envText = readFileSync(ENV_PATH, "utf8");
const env = {};
for (const raw of envText.split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  let val = line.slice(eq + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  env[key] = val;
}

const APP_ID = env.EBAY_APP_ID;
const CERT_ID = env.EBAY_CERT_ID;
const DEV_ID = env.EBAY_DEV_ID;
const REFRESH = env.EBAY_REFRESH_TOKEN;
const COMPAT = env.EBAY_COMPAT_LEVEL ?? "1207";
const SITE_ID = env.EBAY_SITE_ID ?? "0";
const EBAY_ENV = (env.EBAY_ENV ?? "sandbox").toLowerCase();
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "https://ebay-passthru.vercel.app/api/webhooks/ebay";

const missing = [];
if (!APP_ID) missing.push("EBAY_APP_ID");
if (!CERT_ID) missing.push("EBAY_CERT_ID");
if (!DEV_ID) missing.push("EBAY_DEV_ID");
if (!REFRESH) missing.push("EBAY_REFRESH_TOKEN");
if (missing.length) {
  console.error(`Missing .env.local values: ${missing.join(", ")}`);
  process.exit(1);
}

const apiHost = EBAY_ENV === "production" ? "api.ebay.com" : "api.sandbox.ebay.com";
const identityHost = apiHost;
const tradingEndpoint = `https://${apiHost}/ws/api.dll`;

// ----- Mint an access token from the refresh token -----------------------

async function mintAccessToken() {
  const basic = Buffer.from(`${APP_ID}:${CERT_ID}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: REFRESH,
  }).toString();
  const r = await fetch(`https://${identityHost}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`refresh exchange failed: HTTP ${r.status} ${t}`);
  return JSON.parse(t).access_token;
}

// ----- Trading API call helper -------------------------------------------

async function callTrading(callName, innerXml, accessToken) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  ${innerXml}
</${callName}Request>`;
  const r = await fetch(tradingEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT,
      "X-EBAY-API-DEV-NAME": DEV_ID,
      "X-EBAY-API-APP-NAME": APP_ID,
      "X-EBAY-API-CERT-NAME": CERT_ID,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": SITE_ID,
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body,
  });
  const text = await r.text();
  const ack = /<Ack>([^<]+)<\/Ack>/.exec(text)?.[1] ?? "";
  const errors = [...text.matchAll(/<ShortMessage>([^<]+)<\/ShortMessage>/g)].map((m) => m[1]);
  return { status: r.status, ack, errors, rawXml: text };
}

// ----- Event types we want to receive ------------------------------------

const EVENTS = [
  "BestOffer",
  "BestOfferPlaced",
  "BestOfferDeclined",
  "BestOfferRemoved",
  "AuctionCheckoutComplete",
  "BidReceived",
];

function buildSetPreferencesXml(enable) {
  const eventsXml = EVENTS.map(
    (e) => `<NotificationEnable><EventType>${e}</EventType><EventEnable>${enable ? "Enable" : "Disable"}</EventEnable></NotificationEnable>`,
  ).join("");
  return `
<ApplicationDeliveryPreferences>
  <ApplicationURL>${WEBHOOK_URL}</ApplicationURL>
  <ApplicationEnable>${enable ? "Enable" : "Disable"}</ApplicationEnable>
  <AlertEnable>${enable ? "Enable" : "Disable"}</AlertEnable>
  <DeviceType>Platform</DeviceType>
  <PayloadVersion>${COMPAT}</PayloadVersion>
</ApplicationDeliveryPreferences>
<UserDeliveryPreferenceArray>
  ${eventsXml}
</UserDeliveryPreferenceArray>`;
}

// ----- Main --------------------------------------------------------------

const cmd = process.argv[2] ?? "enable";

console.log(`Environment: ${EBAY_ENV}`);
console.log(`Webhook URL: ${WEBHOOK_URL}`);
console.log(`Events:      ${EVENTS.join(", ")}`);
console.log();

const token = await mintAccessToken();

if (cmd === "status") {
  const r = await callTrading("GetNotificationPreferences", "<PreferenceLevel>User</PreferenceLevel>", token);
  console.log(`HTTP ${r.status}  Ack: ${r.ack}`);
  if (r.errors.length) console.log("Errors:", r.errors);
  console.log(r.rawXml);
} else if (cmd === "enable" || cmd === "disable") {
  const enable = cmd === "enable";
  const r = await callTrading("SetNotificationPreferences", buildSetPreferencesXml(enable), token);
  console.log(`HTTP ${r.status}  Ack: ${r.ack}`);
  if (r.errors.length) console.log("Errors:", r.errors);
  if (r.ack === "Success" || r.ack === "Warning") {
    console.log(`\n${enable ? "Subscribed" : "Unsubscribed"}. Test it:`);
    console.log(`  node scripts/test-webhook.mjs`);
  } else {
    console.log("\nFull response:");
    console.log(r.rawXml);
  }
} else {
  console.error(`Unknown command: ${cmd}. Use enable | disable | status.`);
  process.exit(1);
}

// Sends a synthetic best-offer notification at the webhook so you can
// verify the receiver parses + stores correctly without waiting for a
// real eBay event.
//
//   node scripts/test-webhook.mjs                              # local dev
//   WEBHOOK_URL=https://ebay-passthru.vercel.app/api/webhooks/ebay node scripts/test-webhook.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const ENV_PATH = new URL("../.env.local", import.meta.url);
const env = {};
for (const raw of readFileSync(ENV_PATH, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  let val = line.slice(eq + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  env[key] = val;
}

const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "http://localhost:3000/api/webhooks/ebay";
const timestamp = new Date().toISOString();
const signature = createHash("md5")
  .update(timestamp + env.EBAY_DEV_ID + env.EBAY_APP_ID + env.EBAY_CERT_ID)
  .digest("base64");

const xml = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetItemTransactionsResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <Timestamp>${timestamp}</Timestamp>
      <Ack>Success</Ack>
      <NotificationEventName>BestOfferPlaced</NotificationEventName>
      <RecipientUserID>test-seller</RecipientUserID>
      <RequesterCredentials>
        <NotificationSignature>${signature}</NotificationSignature>
      </RequesterCredentials>
      <Item>
        <ItemID>999999999</ItemID>
        <Title>SYNTHETIC TEST: Mickey Mantle 1952 Topps #311</Title>
      </Item>
      <BestOffer>
        <BestOfferID>fake-offer-${Date.now()}</BestOfferID>
        <Status>Pending</Status>
        <Price currencyID="USD">12500.00</Price>
        <Quantity>1</Quantity>
        <Buyer>
          <UserID>some_buyer_42</UserID>
        </Buyer>
      </BestOffer>
    </GetItemTransactionsResponse>
  </soap:Body>
</soap:Envelope>`;

const r = await fetch(WEBHOOK_URL, {
  method: "POST",
  headers: { "Content-Type": "text/xml" },
  body: xml,
});
console.log(`POST ${WEBHOOK_URL} → HTTP ${r.status}`);
console.log(await r.text());

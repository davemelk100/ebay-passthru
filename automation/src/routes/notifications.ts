import { Hono } from "hono";
import { log } from "../lib/log.js";

export const ebayWebhook = new Hono();

// POST /webhooks/ebay
// eBay Platform Notifications deliver SOAP/XML to this URL. The full handler
// (signature verification, parsing, enqueue for evaluation, fast 200 ACK)
// will be ported from ../app/api/webhooks/ebay/route.ts in the existing
// ebay-passthru app. For v0 of the scaffold this just acks and logs so the
// route is wired through Hono end-to-end.
ebayWebhook.post("/", async (c) => {
  const body = await c.req.text();
  log.info(
    {
      route: "/webhooks/ebay",
      bytes: body.length,
      contentType: c.req.header("content-type"),
    },
    "ebay webhook received (stub)",
  );
  return c.json({ ok: true, parsed: false, stub: true });
});

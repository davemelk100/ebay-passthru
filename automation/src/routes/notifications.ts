import { Hono } from "hono";
import { configFromEnv } from "../domain/ebay/config.js";
import { parseNotificationXml } from "../domain/ebay/notifications.js";
import { log } from "../lib/log.js";

export const ebayWebhook = new Hono();

// POST /webhooks/ebay
//
// eBay Platform Notifications deliver SOAP/XML to this URL. Contract with
// eBay: return HTTP 200 as fast as possible — non-200 is treated as "go away"
// and the event is silently dropped (no automatic redelivery). So the
// receiver does the cheap, deterministic work inline (parse, signature
// verify, normalize) and pushes anything expensive (GetBestOffers enrichment
// fallback, rule evaluation, RespondToBestOffer call) to a downstream job
// once that pipeline lands.
ebayWebhook.post("/", async (c) => {
  const xml = await c.req.text();
  const cfg = configFromEnv();

  const { notification, error } = parseNotificationXml(xml, {
    devId: cfg.devId,
    appId: cfg.appId,
    certId: cfg.certId,
  });

  if (error || !notification) {
    log.warn(
      { route: "/webhooks/ebay", bytes: xml.length, error },
      "could not parse eBay notification",
    );
    // Still 200 — eBay's redelivery model means a 4xx/5xx here just loses
    // the event. Logging is enough for operator triage.
    return c.json({ ok: true, parsed: false, error });
  }

  log.info(
    {
      route: "/webhooks/ebay",
      eventName: notification.eventName,
      timestamp: notification.timestamp,
      itemId: notification.itemId,
      bestOfferId: notification.bestOfferId,
      offerPrice: notification.offerPrice,
      currency: notification.currency,
      buyerUserId: notification.buyerUserId,
      signatureValid: notification.signatureValid,
    },
    notification.signatureValid ? "notification received" : "notification received (unsigned)",
  );

  // TODO(arch): enqueue evaluation job once the rule engine + queue land.
  return c.json({
    ok: true,
    eventName: notification.eventName,
    signatureValid: notification.signatureValid,
  });
});

import { Hono } from "hono";
import { log } from "../../lib/log.js";

export const reconcileJob = new Hono();

// POST /jobs/reconcile
// Cloud Scheduler fires this on a cadence (default 15–30 min). The actual
// implementation walks GetMyeBaySelling for items with active offers, calls
// GetBestOffers per item, deduplicates against the offer_decision table by
// BestOfferID, and enqueues each new offer for rule evaluation. Stub for v0.
reconcileJob.post("/", async (c) => {
  log.info({ route: "/jobs/reconcile" }, "reconciliation tick (stub)");
  return c.json({ ok: true, stub: true, enqueued: 0 });
});

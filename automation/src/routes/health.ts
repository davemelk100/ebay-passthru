import { Hono } from "hono";

export const health = new Hono();

// Cloud Run health checks hit / by default but supports custom paths. We
// expose both common conventions so liveness/readiness probes can use the
// same image without configuration.
health.get("/healthz", (c) => c.json({ ok: true }));
health.get("/readyz", (c) => c.json({ ok: true }));
health.get("/", (c) => c.json({ ok: true, service: "ebay-best-offer-automation" }));

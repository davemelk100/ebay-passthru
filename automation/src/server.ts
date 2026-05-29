import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { env } from "./lib/env.js";
import { log } from "./lib/log.js";
import { health } from "./routes/health.js";
import { ebayWebhook } from "./routes/notifications.js";
import { reconcileJob } from "./routes/jobs/reconcile.js";
import { rulesAdmin } from "./routes/admin/rules.js";
import { feesAdmin } from "./routes/admin/fees.js";
import { historyAdmin } from "./routes/admin/history.js";

const app = new Hono();

app.use("*", logger());

// Public ingress
app.route("/", health);
app.route("/webhooks/ebay", ebayWebhook);

// Scheduled jobs (Cloud Scheduler — should be IAM-locked in deploy, not
// here, so we don't double-authenticate when running locally).
app.route("/jobs/reconcile", reconcileJob);

// Admin surface (shared bearer in v0; SSO later)
app.route("/admin/rules", rulesAdmin);
app.route("/admin/fees", feesAdmin);
app.route("/admin/history", historyAdmin);

// Fallback
app.notFound((c) => c.json({ ok: false, error: "not found", path: c.req.path }, 404));
app.onError((err, c) => {
  log.error({ err: { message: err.message, stack: err.stack } }, "unhandled error");
  return c.json({ ok: false, error: "internal error" }, 500);
});

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  log.info({ port, env: env.NODE_ENV, ebayEnv: env.EBAY_ENV }, "service listening");
});

export default app;

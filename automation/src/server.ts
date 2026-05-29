import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { db } from "./db/client.js";
import { env } from "./lib/env.js";
import { log } from "./lib/log.js";
import { bearerAuth } from "./lib/auth.js";
import { health } from "./routes/health.js";
import { ebayWebhook } from "./routes/notifications.js";
import { reconcileJob } from "./routes/jobs/reconcile.js";
import { buildRulesAdmin } from "./routes/admin/rules.js";
import { buildFeesAdmin } from "./routes/admin/fees.js";
import { buildHistoryAdmin } from "./routes/admin/history.js";

const app = new Hono();

app.use("*", logger());

// Public ingress
app.route("/", health);
app.route("/webhooks/ebay", ebayWebhook);

// Scheduled jobs (IAM-locked at the Cloud Run side, not here)
app.route("/jobs/reconcile", reconcileJob);

// Admin surface — shared-bearer gate for v0; SSO later.
app.use("/admin/*", bearerAuth(env.ADMIN_BEARER_TOKEN));
app.route("/admin/rules", buildRulesAdmin(db));
app.route("/admin/fees", buildFeesAdmin(db));
app.route("/admin/history", buildHistoryAdmin(db));

app.notFound((c) => c.json({ ok: false, error: "not found", path: c.req.path }, 404));
app.onError((err, c) => {
  log.error({ err: { message: err.message, stack: err.stack } }, "unhandled error");
  return c.json({ ok: false, error: "internal error" }, 500);
});

serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  log.info({ port, env: env.NODE_ENV, ebayEnv: env.EBAY_ENV }, "service listening");
});

export default app;

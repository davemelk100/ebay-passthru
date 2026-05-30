import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import { listRuleSets } from "../../db/rule-set-queries.js";
import { LEGACY_CARDZ_DEFAULTS } from "../../domain/fees.js";
import { escapeHtml, layout } from "../../lib/layout.js";

export function buildFeesAdmin(db: Db): Hono {
  const app = new Hono();

  // The "active" fee profile is whichever profile rides with the currently-
  // published rule set. There's no separate fee_profile editor — fees are
  // published atomically with rules so the audit row's feeProfileSnapshot
  // always lines up with the matching rule_set version.

  app.get("/defaults", (c) => c.json({ ok: true, profile: LEGACY_CARDZ_DEFAULTS }));

  app.get("/", async (c) => {
    const wantsJson = c.req.header("accept")?.includes("application/json");
    const published = (await listRuleSets(db, { status: "published", limit: 1 }))[0] ?? null;
    if (wantsJson) {
      return c.json({
        ok: true,
        active: published
          ? { ruleSetVersion: published.version, profile: published.feeProfile }
          : null,
        defaults: LEGACY_CARDZ_DEFAULTS,
      });
    }
    const activeBlock = published
      ? `<fieldset>
          <legend>Active fee profile (from rule set v${published.version})</legend>
          <pre class="codeblock">${escapeHtml(JSON.stringify(published.feeProfile, null, 2))}</pre>
          <p class="muted">To edit, open the rule set and edit its fee profile inline. Fees and rules publish together so the audit snapshot stays consistent.</p>
          <p><a class="btn btn-ghost" href="/admin/rules/${published.id}">Open rule set v${published.version}</a></p>
        </fieldset>`
      : `<div class="alert alert-error">No published rule set yet — fees come from the published row.</div>`;
    const defaultsBlock = `<fieldset>
        <legend>Legacy Cardz defaults (seed for new drafts)</legend>
        <pre class="codeblock">${escapeHtml(JSON.stringify(LEGACY_CARDZ_DEFAULTS, null, 2))}</pre>
      </fieldset>`;
    return c.html(
      layout({
        title: "Fees",
        current: "fees",
        body: `<h1>Fee profile</h1>${activeBlock}${defaultsBlock}`,
      }),
    );
  });

  return app;
}

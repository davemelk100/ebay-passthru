import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import {
  createDraft,
  getRuleSetById,
  listRuleSets,
  publishRuleSet,
  updateDraft,
  type RuleSetRow,
} from "../../db/rule-set-queries.js";
import { LEGACY_CARDZ_DEFAULTS } from "../../domain/fees.js";
import { ruleSetBodySchema, type RuleSetBody } from "../../domain/rules-schema.js";
import { escapeHtml, layout, pill } from "../../lib/layout.js";

export function buildRulesAdmin(db: Db): Hono {
  const app = new Hono();

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rules — list view
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/", async (c) => {
    const rows = await listRuleSets(db);
    const wantsJson = c.req.header("accept")?.includes("application/json");
    if (wantsJson) {
      return c.json({ ok: true, items: rows });
    }
    return c.html(renderList(rows));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rules — create a new draft (seeded with the active published
  // ruleset's body if one exists, otherwise the Legacy Cardz defaults +
  // a single placeholder rule).
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // Form-encoded POST from the "New draft" button on the list page —
      // seed defaults so the operator can edit on the next screen. The seed
      // came from the prior published row (which the zod schema already
      // validated when it was originally created) so re-validation here is
      // unnecessary; cast directly to the typed body.
      const seed = (await seedFromActive(db)) as RuleSetBody;
      const created = await createDraft(db, seed);
      return c.redirect(`/admin/rules/${created.id}`, 303);
    }
    const parsed = ruleSetBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, errors: parsed.error.flatten() }, 400);
    }
    const created = await createDraft(db, parsed.data);
    return c.json({ ok: true, ruleSet: created }, 201);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rules/published
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/published", async (c) => {
    const rows = await listRuleSets(db, { status: "published", limit: 1 });
    const row = rows[0] ?? null;
    const wantsJson = c.req.header("accept")?.includes("application/json");
    if (wantsJson) {
      return c.json({ ok: true, ruleSet: row });
    }
    if (!row) {
      return c.html(
        layout({
          title: "Rules — Published",
          current: "rules",
          body: `<h1>Published ruleset</h1><p class="muted">No published ruleset yet.</p>`,
        }),
      );
    }
    return c.redirect(`/admin/rules/${row.id}`, 302);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rules/:id — drill-down / edit page
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/:id", async (c) => {
    const row = await getRuleSetById(db, c.req.param("id"));
    if (!row) {
      return c.html(notFound("Ruleset not found", "rules"), 404);
    }
    const wantsJson = c.req.header("accept")?.includes("application/json");
    if (wantsJson) return c.json({ ok: true, ruleSet: row });
    return c.html(renderDetail(row));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rules/:id — update draft from form OR JSON
  //   - PATCH-equivalent. Lets the HTML form submit a regular POST.
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/:id", async (c) => {
    const id = c.req.param("id");
    const ct = c.req.header("content-type") ?? "";
    let body: unknown;
    if (ct.includes("application/json")) {
      try {
        body = await c.req.json();
      } catch {
        return c.json({ ok: false, error: "invalid JSON" }, 400);
      }
    } else {
      const form = await c.req.parseBody();
      try {
        const rules = JSON.parse(String(form.rules ?? "[]"));
        const feeProfile = JSON.parse(String(form.feeProfile ?? "{}"));
        body = { rules, feeProfile };
      } catch (e) {
        return c.html(
          layout({
            title: "Edit ruleset",
            current: "rules",
            body: `<div class="alert alert-error">Invalid JSON: ${escapeHtml((e as Error).message)}</div><p><a class="btn btn-ghost" href="/admin/rules/${id}">Back</a></p>`,
          }),
          400,
        );
      }
    }
    const parsed = ruleSetBodySchema.safeParse(body);
    if (!parsed.success) {
      if (ct.includes("application/json")) {
        return c.json({ ok: false, errors: parsed.error.flatten() }, 400);
      }
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
      return c.html(
        layout({
          title: "Edit ruleset",
          current: "rules",
          body: `<div class="alert alert-error">Validation failed:<pre class="codeblock">${escapeHtml(issues)}</pre></div><p><a class="btn btn-ghost" href="/admin/rules/${id}">Back</a></p>`,
        }),
        400,
      );
    }
    try {
      const updated = await updateDraft(db, id, parsed.data);
      if (ct.includes("application/json")) return c.json({ ok: true, ruleSet: updated });
      return c.redirect(`/admin/rules/${id}?saved=1`, 303);
    } catch (e) {
      const msg = (e as Error).message;
      if (ct.includes("application/json")) return c.json({ ok: false, error: msg }, 400);
      return c.html(
        layout({
          title: "Edit ruleset",
          current: "rules",
          body: `<div class="alert alert-error">${escapeHtml(msg)}</div><p><a class="btn btn-ghost" href="/admin/rules/${id}">Back</a></p>`,
        }),
        400,
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rules/:id/publish — swap statuses atomically
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/:id/publish", async (c) => {
    const id = c.req.param("id");
    try {
      const updated = await publishRuleSet(db, id, null);
      const wantsJson = c.req.header("accept")?.includes("application/json");
      if (wantsJson) return c.json({ ok: true, ruleSet: updated });
      return c.redirect(`/admin/rules/${id}?published=1`, 303);
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 400);
    }
  });

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function seedFromActive(db: Db): Promise<{ rules: unknown[]; feeProfile: unknown }> {
  const published = await listRuleSets(db, { status: "published", limit: 1 });
  if (published[0]) {
    return {
      rules: (published[0].rules as unknown[]) ?? [],
      feeProfile: published[0].feeProfile ?? LEGACY_CARDZ_DEFAULTS,
    };
  }
  return {
    rules: [
      {
        name: "accept-high",
        when: { ratio_gte: 0.85 },
        action: { type: "accept" },
      },
    ],
    feeProfile: LEGACY_CARDZ_DEFAULTS,
  };
}

function statusPill(s: RuleSetRow["status"]): string {
  return pill(s, s);
}

function renderList(rows: RuleSetRow[]): string {
  const tbody =
    rows.length === 0
      ? `<tr><td colspan="5" class="muted">No rulesets yet — click "New draft" to create one.</td></tr>`
      : rows
          .map(
            (r) => `<tr>
              <td class="mono">v${r.version}</td>
              <td>${statusPill(r.status)}</td>
              <td>${r.publishedAt ? new Date(r.publishedAt).toISOString() : `<span class="muted">—</span>`}</td>
              <td>${escapeHtml(r.publishedBy ?? "")}</td>
              <td><a class="btn btn-ghost" href="/admin/rules/${r.id}">Open</a></td>
            </tr>`,
          )
          .join("");
  const body = `<h1>Rule sets</h1>
    <div class="toolbar">
      <form action="/admin/rules" method="post">
        <button class="btn btn-primary" type="submit">+ New draft</button>
      </form>
    </div>
    <table>
      <thead><tr><th>Version</th><th>Status</th><th>Published at</th><th>Published by</th><th></th></tr></thead>
      <tbody>${tbody}</tbody>
    </table>`;
  return layout({ title: "Rule sets", current: "rules", body });
}

function renderDetail(row: RuleSetRow): string {
  const rulesJson = JSON.stringify(row.rules, null, 2);
  const feeJson = JSON.stringify(row.feeProfile, null, 2);
  const editable = row.status === "draft";
  const editForm = editable
    ? `<form action="/admin/rules/${row.id}" method="post">
        <fieldset><legend>Rules JSON</legend><textarea name="rules">${escapeHtml(rulesJson)}</textarea></fieldset>
        <fieldset><legend>Fee profile JSON</legend><textarea name="feeProfile" style="min-height:8rem">${escapeHtml(feeJson)}</textarea></fieldset>
        <button class="btn btn-primary" type="submit">Save draft</button>
        <a class="btn btn-ghost" href="/admin/rules">Cancel</a>
      </form>
      <form action="/admin/rules/${row.id}/publish" method="post" style="margin-top:1rem">
        <button class="btn" type="submit" onclick="return confirm('Publish ruleset v${row.version}? Any currently published row will be archived.')">Publish</button>
      </form>`
    : `<fieldset><legend>Rules</legend><pre class="codeblock">${escapeHtml(rulesJson)}</pre></fieldset>
       <fieldset><legend>Fee profile</legend><pre class="codeblock">${escapeHtml(feeJson)}</pre></fieldset>
       ${row.status === "archived" ? `<form action="/admin/rules/${row.id}/publish" method="post"><button class="btn" type="submit" onclick="return confirm('Roll back to v${row.version}?')">Roll back to this version</button></form>` : ""}`;

  const meta = `<dl class="form-row">
      <div><label>Version</label><div class="mono">v${row.version}</div></div>
      <div><label>Status</label><div>${statusPill(row.status)}</div></div>
      <div><label>Created</label><div class="mono">${new Date(row.createdAt).toISOString()}</div></div>
      <div><label>Published at</label><div class="mono">${row.publishedAt ? new Date(row.publishedAt).toISOString() : "—"}</div></div>
    </dl>`;
  const body = `<h1>Rule set <span class="mono">v${row.version}</span></h1>
    ${meta}
    ${editForm}`;
  return layout({ title: `Rule set v${row.version}`, current: "rules", body });
}

function notFound(message: string, current: "rules" | "history" | "fees"): string {
  return layout({
    title: "Not found",
    current,
    body: `<h1>${escapeHtml(message)}</h1><p><a class="btn btn-ghost" href="/admin/${current}">Back</a></p>`,
  });
}

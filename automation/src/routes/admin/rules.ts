import { Hono } from "hono";

export const rulesAdmin = new Hono();

// GET    /admin/rules           list all rule sets (draft + published + archived)
// GET    /admin/rules/published current published row
// POST   /admin/rules           create a new draft (body = { rules, feeProfile })
// PATCH  /admin/rules/:id       update a draft
// POST   /admin/rules/:id/publish bump version, atomically swap "published"
// All stubs for v0 — real handlers in the next commit on this branch.

rulesAdmin.get("/", (c) => c.json({ ok: true, stub: true, items: [] }));
rulesAdmin.get("/published", (c) => c.json({ ok: true, stub: true, ruleSet: null }));
rulesAdmin.post("/", (c) => c.json({ ok: true, stub: true }, 201));
rulesAdmin.patch("/:id", (c) => c.json({ ok: true, stub: true, id: c.req.param("id") }));
rulesAdmin.post("/:id/publish", (c) => c.json({ ok: true, stub: true, id: c.req.param("id") }));

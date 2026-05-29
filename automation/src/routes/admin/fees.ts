import { Hono } from "hono";
import { LEGACY_CARDZ_DEFAULTS } from "../../domain/fees.js";

export const feesAdmin = new Hono();

// GET    /admin/fees        current active fee profile (embedded in published rule set)
// GET    /admin/fees/defaults Legacy Cardz baseline used to seed the admin editor
// POST   /admin/fees        update the draft fee profile (publishing happens via /admin/rules)

feesAdmin.get("/", (c) => c.json({ ok: true, stub: true, profile: null }));
feesAdmin.get("/defaults", (c) => c.json({ ok: true, profile: LEGACY_CARDZ_DEFAULTS }));
feesAdmin.post("/", (c) => c.json({ ok: true, stub: true }, 201));

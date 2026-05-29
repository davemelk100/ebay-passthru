import { Hono } from "hono";

export const historyAdmin = new Hono();

// GET /admin/history         filterable list of offer_decision rows
//   Query params (future):
//     ?from=ISO&to=ISO       date window
//     ?itemId=…
//     ?ruleId=…
//     ?decision=accept|decline|counter|skipped
//     ?source=notification|reconciliation
//     ?format=json|csv
// GET /admin/history/:id     full audit row + raw eBay payloads

historyAdmin.get("/", (c) => c.json({ ok: true, stub: true, items: [], total: 0 }));
historyAdmin.get("/:id", (c) => c.json({ ok: true, stub: true, id: c.req.param("id") }));

import { Hono } from "hono";
import type { Db } from "../../db/client.js";
import {
  getDecisionById,
  listDecisions,
  type DecisionFilters,
  type DecisionRow,
} from "../../db/decision-queries.js";
import { escapeHtml, layout, pill } from "../../lib/layout.js";

export function buildHistoryAdmin(db: Db): Hono {
  const app = new Hono();

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/history — filterable list of offer decisions
  //   Query params:
  //     ?itemId=… ?decision=accept|decline|counter|… ?source=notification|reconciliation
  //     ?from=ISO ?to=ISO ?limit=N ?format=json|csv
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/", async (c) => {
    const filters: DecisionFilters = {
      itemId: c.req.query("itemId") || undefined,
      decision: c.req.query("decision") || undefined,
      source: (c.req.query("source") as DecisionFilters["source"]) || undefined,
      fromIso: c.req.query("from") || undefined,
      toIso: c.req.query("to") || undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    };
    const rows = await listDecisions(db, filters);
    const fmt = c.req.query("format");
    const wantsJson = fmt === "json" || c.req.header("accept")?.includes("application/json");
    if (wantsJson) return c.json({ ok: true, items: rows, count: rows.length });
    if (fmt === "csv") {
      return c.body(toCsv(rows), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="offer-decisions.csv"`,
      });
    }
    return c.html(renderList(rows, filters));
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/history/:id — drill-down on a single decision row
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/:id", async (c) => {
    const row = await getDecisionById(db, c.req.param("id"));
    const wantsJson = c.req.header("accept")?.includes("application/json");
    if (!row) {
      if (wantsJson) return c.json({ ok: false, error: "not found" }, 404);
      return c.html(
        layout({
          title: "Decision not found",
          current: "history",
          body: `<h1>Decision not found</h1><p><a class="btn btn-ghost" href="/admin/history">Back</a></p>`,
        }),
        404,
      );
    }
    if (wantsJson) return c.json({ ok: true, decision: row });
    return c.html(renderDetail(row));
  });

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderList(rows: DecisionRow[], filters: DecisionFilters): string {
  const tbody =
    rows.length === 0
      ? `<tr><td colspan="8" class="muted">No decisions match the current filters.</td></tr>`
      : rows
          .map(
            (r) => `<tr>
              <td class="mono">${new Date(r.receivedAt).toISOString()}</td>
              <td>${pill(r.source, r.source)}</td>
              <td><a class="mono" href="/admin/history/${r.id}">${escapeHtml(r.itemId)}</a></td>
              <td class="mono">${escapeHtml(r.bestOfferId)}</td>
              <td>${pill(r.decision, r.decision)}</td>
              <td class="mono">${escapeHtml(r.matchedRuleId ?? "")}</td>
              <td class="mono">${escapeHtml(r.grossOffer)} ${escapeHtml(r.currency)}</td>
              <td class="mono">${escapeHtml(r.estimatedNet)} ${escapeHtml(r.currency)}</td>
            </tr>`,
          )
          .join("");
  const filtersForm = `<form class="toolbar" method="get" action="/admin/history">
      <input type="text" name="itemId" placeholder="ItemID" value="${escapeHtml(filters.itemId ?? "")}" />
      <select name="decision">
        <option value="">any decision</option>
        ${[
          "accept",
          "decline",
          "counter",
          "skipped",
          "would_have_accepted",
          "would_have_declined",
          "would_have_countered",
        ]
          .map(
            (d) =>
              `<option value="${d}" ${filters.decision === d ? "selected" : ""}>${d}</option>`,
          )
          .join("")}
      </select>
      <select name="source">
        <option value="">any source</option>
        <option value="notification" ${filters.source === "notification" ? "selected" : ""}>notification</option>
        <option value="reconciliation" ${filters.source === "reconciliation" ? "selected" : ""}>reconciliation</option>
      </select>
      <input type="date" name="from" value="${escapeHtml((filters.fromIso ?? "").slice(0, 10))}" />
      <input type="date" name="to" value="${escapeHtml((filters.toIso ?? "").slice(0, 10))}" />
      <button class="btn" type="submit">Filter</button>
      <a class="btn btn-ghost" href="/admin/history">Reset</a>
      <a class="btn btn-ghost" href="?${csvQueryString(filters)}">Export CSV</a>
    </form>`;
  return layout({
    title: "Decision history",
    current: "history",
    body: `<h1>Decision history</h1>${filtersForm}
      <table>
        <thead><tr>
          <th>Received</th>
          <th>Source</th>
          <th>ItemID</th>
          <th>BestOfferID</th>
          <th>Decision</th>
          <th>Matched rule</th>
          <th>Gross offer</th>
          <th>Estimated net</th>
        </tr></thead>
        <tbody>${tbody}</tbody>
      </table>
      <p class="muted" style="margin-top:0.5rem">${rows.length} row${rows.length === 1 ? "" : "s"}</p>`,
  });
}

function renderDetail(row: DecisionRow): string {
  const block = (label: string, value: string) =>
    `<div><label>${label}</label><div class="mono">${escapeHtml(value)}</div></div>`;
  const body = `<h1>Decision <span class="mono">${escapeHtml(row.bestOfferId)}</span></h1>
    <p><a class="btn btn-ghost" href="/admin/history">← Back to list</a></p>
    <fieldset><legend>Identity</legend>
      <div class="form-row">
        ${block("Received at", new Date(row.receivedAt).toISOString())}
        ${block("Source", row.source)}
        ${block("Correlation ID", row.correlationId)}
        ${block("ItemID", row.itemId)}
        ${block("BestOfferID", row.bestOfferId)}
        ${block("Buyer UserID", row.buyerUserId ?? "—")}
      </div>
    </fieldset>
    <fieldset><legend>Offer</legend>
      <div class="form-row">
        ${block("Currency", row.currency)}
        ${block("Quantity", String(row.quantity))}
        ${block("Gross offer", row.grossOffer)}
        ${block("Gross BIN", row.grossBin ?? "—")}
      </div>
    </fieldset>
    <fieldset><legend>Fee breakdown (snapshot)</legend>
      <div class="form-row">
        ${block("FVF raw", row.fvfRaw)}
        ${block("FVF after TRS", row.fvfAfterTrs)}
        ${block("Fixed fee", row.fixedFee)}
        ${block("Estimated net", row.estimatedNet)}
      </div>
      <p class="muted" style="margin-top:0.5rem">Profile used:</p>
      <pre class="codeblock">${escapeHtml(JSON.stringify(row.feeProfileSnapshot, null, 2))}</pre>
    </fieldset>
    <fieldset><legend>Decision</legend>
      <div class="form-row">
        ${block("Rule set version", "v" + row.ruleSetVersion)}
        ${block("Matched rule", row.matchedRuleId ?? "—")}
        ${block("Decision", row.decision)}
        ${block("Counter price", row.counterPrice ?? "—")}
        ${block("Counter quantity", row.counterQuantity !== null ? String(row.counterQuantity) : "—")}
        ${block("Dry-run", String(row.dryRun))}
      </div>
    </fieldset>
    <fieldset><legend>Execution</legend>
      <div class="form-row">
        ${block("Ack", row.ack ?? "—")}
      </div>
      <p class="muted" style="margin-top:0.5rem">Errors (if any):</p>
      <pre class="codeblock">${escapeHtml(JSON.stringify(row.errors ?? [], null, 2))}</pre>
    </fieldset>`;
  return layout({
    title: `Decision ${row.bestOfferId}`,
    current: "history",
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export
// ─────────────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  "receivedAt",
  "source",
  "correlationId",
  "itemId",
  "bestOfferId",
  "buyerUserId",
  "quantity",
  "currency",
  "grossOffer",
  "grossBin",
  "fvfRaw",
  "fvfAfterTrs",
  "fixedFee",
  "estimatedNet",
  "ruleSetVersion",
  "matchedRuleId",
  "decision",
  "counterPrice",
  "counterQuantity",
  "dryRun",
  "ack",
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: DecisionRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const data = rows
    .map((r) =>
      CSV_COLUMNS.map((k) => csvCell((r as unknown as Record<string, unknown>)[k])).join(","),
    )
    .join("\n");
  return `${header}\n${data}\n`;
}

function csvQueryString(filters: DecisionFilters): string {
  const params = new URLSearchParams();
  if (filters.itemId) params.set("itemId", filters.itemId);
  if (filters.decision) params.set("decision", filters.decision);
  if (filters.source) params.set("source", filters.source);
  if (filters.fromIso) params.set("from", filters.fromIso);
  if (filters.toIso) params.set("to", filters.toIso);
  params.set("format", "csv");
  return params.toString();
}

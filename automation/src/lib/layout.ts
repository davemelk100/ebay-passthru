import { html, raw } from "hono/html";

// Minimal HTML shell shared across every admin view. Inline CSS keeps the
// service single-file-on-Cloud-Run friendly — no static asset bucket needed.
// Black-on-white, system fonts, simple table + form styling. Decisions get
// color-coded badges for at-a-glance scanning.

const STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    color: #1a1a1a;
    background: #f7f7f7;
    line-height: 1.5;
  }
  header {
    background: #1a1a1a;
    color: #f7f7f7;
    padding: 0.75rem 1.25rem;
    display: flex;
    gap: 1.25rem;
    align-items: center;
  }
  header .brand { font-weight: 600; }
  header nav { display: flex; gap: 1rem; margin-left: auto; }
  header nav a {
    color: #d1d1d1;
    text-decoration: none;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }
  header nav a:hover { background: #2a2a2a; color: #fff; }
  header nav a.active { background: #fff; color: #1a1a1a; }
  main { max-width: 1280px; margin: 0 auto; padding: 1.5rem 1.25rem; }
  h1 { margin: 0 0 1rem; font-size: 1.5rem; }
  h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; }
  table { border-collapse: collapse; width: 100%; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ececec; font-size: 0.875rem; vertical-align: top; }
  th { background: #fafafa; font-weight: 600; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; color: #555; }
  tr:last-child td { border-bottom: none; }
  .pill { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 500; }
  .pill-draft { background: #fff3c4; color: #7a5c00; }
  .pill-published { background: #c8efc8; color: #1f6f1f; }
  .pill-archived { background: #e6e6e6; color: #4a4a4a; }
  .pill-accept { background: #c8efc8; color: #1f6f1f; }
  .pill-decline { background: #f3c6c6; color: #7a1f1f; }
  .pill-counter { background: #ffe6b3; color: #7a5300; }
  .pill-skipped { background: #e6e6e6; color: #4a4a4a; }
  .pill-would_have_accepted, .pill-would_have_declined, .pill-would_have_countered { background: #e0e7ff; color: #2a3a8a; }
  .pill-notification { background: #d0e8ff; color: #1f3f7a; }
  .pill-reconciliation { background: #e6e6e6; color: #4a4a4a; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; }
  .muted { color: #888; }
  .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
  .toolbar form { display: flex; gap: 0.5rem; align-items: center; }
  .btn { display: inline-block; padding: 0.4rem 0.85rem; background: #1a1a1a; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-size: 0.875rem; text-decoration: none; }
  .btn:hover { background: #2a2a2a; }
  .btn-primary { background: #2266ff; }
  .btn-primary:hover { background: #1450dd; }
  .btn-danger { background: #cc3333; }
  .btn-danger:hover { background: #b02020; }
  .btn-ghost { background: #fff; color: #1a1a1a; border: 1px solid #ccc; }
  .btn-ghost:hover { background: #f0f0f0; }
  input[type=text], input[type=number], input[type=date], textarea, select {
    padding: 0.35rem 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font: inherit;
    font-size: 0.875rem;
    background: #fff;
  }
  textarea { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; min-height: 18rem; }
  fieldset { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; background: #fff; }
  legend { padding: 0 0.5rem; font-weight: 600; }
  label { display: block; font-size: 0.85rem; margin-bottom: 0.25rem; color: #555; }
  .form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
  .alert { padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem; }
  .alert-error { background: #fde0e0; border-left: 4px solid #cc3333; }
  .alert-success { background: #e0f0e0; border-left: 4px solid #2a8a2a; }
  pre.codeblock { background: #1a1a1a; color: #c8e8c8; padding: 0.75rem; border-radius: 4px; overflow-x: auto; font-size: 0.8rem; }
`;

export type ActiveSection = "rules" | "fees" | "history";

export interface LayoutInput {
  title: string;
  current?: ActiveSection;
  body: string;
}

export function layout(input: LayoutInput): string {
  const nav = (slug: ActiveSection, label: string) =>
    `<a href="/admin/${slug}" class="${input.current === slug ? "active" : ""}">${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)} — eBay automation</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <header>
      <div class="brand">eBay Best Offer Automation</div>
      <nav>
        ${nav("rules", "Rules")}
        ${nav("fees", "Fees")}
        ${nav("history", "History")}
      </nav>
    </header>
    <main>${input.body}</main>
  </body>
</html>`;
}

export function pill(text: string, cls: string): string {
  return `<span class="pill pill-${cls}">${escapeHtml(text)}</span>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

// hono/html marker — lets callers compose with the html tagged template too.
// We mostly use raw strings here for terseness; both are XSS-safe as long as
// untrusted content goes through escapeHtml().
export { html, raw };

# ebay-passthru

A small Next.js + TypeScript app that:

1. Acts as a server-side **passthrough** to the eBay **Trading API** (legacy XML).
2. **Shows the feed** — pulls `GetMyeBaySelling` (ActiveList) and renders a table.
3. **Verifies CRUD** end-to-end: `AddItem` → `GetItem` → `ReviseItem` → `EndItem`, with PASS/FAIL per step.

## Setup

```bash
cp .env.local.example .env.local
# fill in EBAY_APP_ID, EBAY_DEV_ID, EBAY_CERT_ID, EBAY_AUTH_TOKEN
# leave EBAY_ENV=sandbox until you're sure
npm install
npm run dev
```

Then open http://localhost:3000.

## Env vars

| var | description |
| --- | --- |
| `EBAY_ENV` | `sandbox` (default) or `production` |
| `EBAY_APP_ID` | Trading API App ID (Client ID) |
| `EBAY_DEV_ID` | Dev ID |
| `EBAY_CERT_ID` | Cert ID (Client Secret) |
| `EBAY_AUTH_TOKEN` | User Auth Token for the seller account |
| `EBAY_SITE_ID` | Site ID (0 = US) |
| `EBAY_COMPAT_LEVEL` | Compatibility level (default `1193`) |

Get keys at https://developer.ebay.com/my/keys. The Auth Token is per-user — use **Get a User Token** in the developer portal to mint one for your sandbox test user.

## Routes

- `GET /api/ebay` — returns the current config (env, siteId, missing vars).
- `POST /api/ebay` — body: `{ callName: string, xml: string }`. The server wraps the XML in the standard Trading API envelope, injects `RequesterCredentials`, adds the eBay HTTP headers, and returns `{ ok, status, ack, errors, rawXml, parsed, durationMs }`.
- `POST /api/crud-check` — body: `{ allowProduction?: boolean }`. Runs the 4-step CRUD pipeline and returns a per-step report.

## CRUD check details

The Create step uses a hard-coded sample listing (book category 9355, fixed price, USPS). **Sandbox listings sometimes fail** because eBay rejects sample inputs that don't satisfy current business-policy requirements — that's not a bug in this app; read the returned errors. Production is blocked unless the request includes `"allowProduction": true`, since the Create step publishes a real listing.

## Notes

- All eBay credentials live on the server; nothing is exposed to the browser.
- The Trading API is XML-only — the passthrough accepts either an inner snippet (it adds the envelope) or a full `<CallNameRequest>` doc.
- Parsing uses `fast-xml-parser`. The raw XML is preserved in every response so you can diff against the eBay docs.

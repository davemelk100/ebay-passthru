# ebay-passthru

A Next.js + TypeScript app that acts as a server-side **passthrough to the eBay Trading API** (legacy XML), with a browser UI for sending calls and inspecting responses. Auth is OAuth user tokens with auto-refresh; credentials never leave the server.

## How it works (architecture)

```
Browser ─────► /api/ebay ─────► curl (subprocess) ─────► api.sandbox.ebay.com/ws/api.dll
  (JSON)        (Node.js)         (POSTs XML)              (Trading API)
                    │
                    ├── readConfig()            reads env vars
                    ├── getAccessToken()        cached OAuth token; refresh on expiry
                    ├── buildRequestBody()      wraps inner XML in <CallNameRequest>
                    └── curlPost()              shells out (see "Why curl, not fetch")
```

### Request lifecycle

1. The UI (`app/components/CallPanel.tsx`) sends `{ callName, xml }` as JSON to `POST /api/ebay`.
2. `app/api/ebay/route.ts` calls `callTradingApi()` in `lib/ebay.ts`.
3. `callTradingApi`:
   - Looks up a valid OAuth access token (cached in memory; auto-refreshed via `EBAY_REFRESH_TOKEN` when within 60s of expiry).
   - Wraps the inner XML in the standard `<CallNameRequest xmlns="urn:ebay:apis:eBLBaseComponents">…</CallNameRequest>` envelope.
   - Spawns `curl` to POST the XML to the Trading API endpoint with all required headers (`X-EBAY-API-CALL-NAME`, `X-EBAY-API-COMPATIBILITY-LEVEL`, `X-EBAY-API-IAF-TOKEN`, etc.).
4. The response XML is parsed with `fast-xml-parser`; both the raw XML and the parsed JSON are returned to the browser.

### Why curl, not fetch

eBay's edge drops the connection mid-response for `POST /ws/api.dll` when called from Node's `fetch`/`https` modules, regardless of headers or TLS options. The same request from the system `curl` binary succeeds — this is a TLS-fingerprint mismatch on eBay's side. To work around it we shell out to `curl` via `node:child_process.execFile`.

This means **the host must have `curl` installed** (true on macOS and most Linux). On Vercel the Node runtime image does include `curl`, but it's untested for this app — if you deploy and see "fetch failed" or empty responses, fall back to a different runtime or reverse-proxy the call.

### Auth flow (OAuth user tokens)

The Trading API accepts OAuth user access tokens via the `X-EBAY-API-IAF-TOKEN` header (instead of legacy Auth'n'Auth `<eBayAuthToken>` in the body).

| Token | Lifetime | Stored in | Role |
| --- | --- | --- | --- |
| Access token | ~2 hours | `EBAY_AUTH_TOKEN` (initial seed) + in-memory cache | Sent on every Trading API call |
| Refresh token | ~18 months | `EBAY_REFRESH_TOKEN` | Exchanged for new access tokens |

On every Trading API call, `getAccessToken()`:
1. Returns the cached access token if it has >60s left.
2. Otherwise POSTs to `/identity/v1/oauth2/token` with `grant_type=refresh_token` (HTTP Basic auth with `appId:certId`) and caches the new access token.
3. If no refresh token is configured, falls back to the static `EBAY_AUTH_TOKEN` (you'll need to re-paste it manually every ~2 hours).

In-flight refreshes are deduped — concurrent calls share a single refresh promise.

## Setup

### Two accounts, two roles

eBay's auth model uses two distinct accounts; mixing them up is the #1 cause of OAuth flow failures.

| Account | Where you sign in | What it owns |
| --- | --- | --- |
| **Developer account** | https://developer.ebay.com | The *app* — App ID, Dev ID, Cert ID, RuName |
| **Seller user account** | https://auth.ebay.com (production) or a *sandbox test user* (sandbox) | The *listings* — inventory the app reads/writes on the user's behalf |

When the OAuth helper opens a consent URL, it's asking the **seller** to authorize the **app**.

- **Sandbox flow** → sign in as a *sandbox test user* (create one at https://developer.ebay.com/sandbox/register). Your real eBay credentials will be rejected.
- **Production flow** → sign in as your *real eBay user account* (the one that owns the inventory). Your developer-portal credentials will be rejected.

The helper script picks which endpoint to hit based on `EBAY_ENV` in `.env.local`. Switch env → re-mint tokens.

### 1. Create an eBay developer account

Sign up at https://developer.ebay.com (free). This is the *developer account* in the table above — you only use it to manage the app keyset and RuNames, never to sign listings.

### 2. Create an app keyset

In the developer portal: **Application Keys → Create a keyset** (Sandbox).
Copy `App ID`, `Dev ID`, `Cert ID` into `.env.local`.

### 3. Configure an OAuth-enabled RuName

Trading-API OAuth requires a RuName (redirect URL name) with OAuth enabled on it:

1. **User Tokens → "Get a Token from eBay via Your Application"** in the developer portal.
2. Add a RuName (any auth-accepted URL works; eBay's defaults are fine for dev).
3. Make sure the OAuth-enabled column shows a green check for that RuName.
4. Copy its full name (e.g. `MyAccount-MyApp-PRD-abc12345-ab1c2def`) into `EBAY_RU_NAME` in `.env.local`.

### 4. Get a seller user account

The OAuth consent flow needs a *seller user* — distinct from your developer-portal login (see "Two accounts, two roles" above).

- **Sandbox** (`EBAY_ENV=sandbox`): create a sandbox test user at https://developer.ebay.com/sandbox/register. Throwaway email/password; not email-verified. Save them — you'll re-use them every time you mint a fresh token.
- **Production** (`EBAY_ENV=production`): use your *real* eBay account (the one that owns the inventory).

### 5. Mint the OAuth tokens (one-time, via the helper script)

```bash
npm install

# Step A — open the consent URL in your browser
node scripts/ebay-oauth.mjs

# Sign in as the seller user account that matches your EBAY_ENV setting:
#   sandbox    -> a sandbox test user (NOT your developer.ebay.com account)
#   production -> your real eBay seller account (NOT your developer.ebay.com account)
# Click "Agree and Continue".
# Copy the URL from the address bar of the resulting tab.

# Step B — exchange the code for tokens
node scripts/ebay-oauth.mjs '<paste-the-url-here>'
```

The script writes `EBAY_AUTH_TOKEN` (access, ~2h) and `EBAY_REFRESH_TOKEN` (~18mo) into `.env.local`. The script picks sandbox vs production endpoints based on `EBAY_ENV`, so **swap envs → re-mint tokens** (sandbox and production tokens are not interchangeable).

You only need to re-run this when:
- The refresh token expires (~18 months)
- You change `EBAY_ENV` between sandbox and production
- You want to switch to a different seller user
- You change OAuth scopes

### 6. Run

```bash
npm run dev
```

Open http://localhost:3000 (or whatever port Next.js picks if 3000 is taken).

## Environment variables

| Var | Required | Description |
| --- | --- | --- |
| `EBAY_ENV` | yes | `sandbox` or `production` |
| `EBAY_APP_ID` | yes | App ID (Client ID) |
| `EBAY_DEV_ID` | yes | Dev ID |
| `EBAY_CERT_ID` | yes | Cert ID (Client Secret) |
| `EBAY_AUTH_TOKEN` | yes | OAuth access token (the helper script populates this) |
| `EBAY_REFRESH_TOKEN` | recommended | OAuth refresh token (the helper script populates this). Without it, the app can't auto-refresh — you'll re-paste `EBAY_AUTH_TOKEN` manually every ~2h |
| `EBAY_RU_NAME` | yes | OAuth-enabled RuName from your eBay app's User Tokens settings. Required by `scripts/ebay-oauth.mjs` — must be the *OAuth-enabled* RuName, not the Auth'n'Auth one |
| `EBAY_SITE_ID` | optional | Default `0` (US) |
| `EBAY_COMPAT_LEVEL` | optional | Default `1193` |

> ⚠️ **Quote tokens in `.env.local`.** OAuth tokens contain `#` characters, which dotenv (used by Next.js) treats as inline comment markers and silently truncates the value. Always write:
>
> ```
> EBAY_AUTH_TOKEN="v^1.1#i^1#r^0#…"
> ```

## Routes

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/api/ebay` | — | `{ env, siteId, compatLevel, missing }` — quick config sanity check |
| `POST` | `/api/ebay` | `{ callName, xml, allowProduction?: boolean }` | `{ ok, status, ack, errors, rawXml, parsed, endpoint, durationMs }`. Destructive calls (`AddItem` / `ReviseItem` / `EndItem` and variants) on `EBAY_ENV=production` are 412'd unless `allowProduction: true` is present. |
| `POST` | `/api/inventory` | `{ entriesPerPage?, daysAhead?, daysBack?, includeEnded?: boolean }` | Paginates `GetSellerList` over a forward `EndTime` window (default 119d forward). Returns a normalized item list — `{ itemId, title, sku, quantity, quantitySold, price, currency, listingType, listingStatus, viewItemUrl, startTime, endTime, primaryCategoryId, primaryCategoryName, pictureUrls }`. With `includeEnded: true`, the window splits backward (default 30d back / 89d ahead) and ended/sold items are included. |
| `POST` | `/api/inventory/clear` | `{ allowProduction?: boolean }` | Enumerates every active listing via `GetMyeBaySelling` pagination, then calls `EndItem` on each. Returns `{ foundCount, endedCount, failedCount, results, durationMs }`. Production-gated. |
| `POST` | `/api/crud-check` | `{ allowProduction?: boolean }` | Per-step report of an `AddItem` → `GetItem` → `ReviseItem` → `EndItem` round-trip. Production-gated. |

The `xml` field is the **inner** body — the server wraps it in `<CallNameRequest>`. If you pass a full envelope (e.g., `<GetItemRequest>…</GetItemRequest>`), it's used as-is.

## UI

The page (`app/page.tsx`) renders three panels:

- **Inventory (GetSellerList)** — `FeedView.tsx`. "Pull full inventory" hits `/api/inventory` and renders the normalized item table. Each row has a **Use** button that stamps the ItemID into shared state so the call panel picks it up. A pill **toggle** ("include ended/sold") flips the request; after the first pull, toggling auto-refreshes the table without a re-click. The red **Clear inventory** button enumerates and ends every active listing — requires a typed challenge string (`CLEAR` on sandbox, `CLEAR PRODUCTION` on prod) before submitting.
- **Trading API passthrough** — `CallPanel.tsx`. One pill button per entry in `lib/samples.ts`. On `EBAY_ENV=production`, destructive pills (Add/Revise/End variants) render disabled with a styled hover tooltip explaining why. Sending in production also triggers a `window.confirm` opt-in. `REPLACE_WITH_ITEM_ID` in samples is auto-substituted with the shared "last selected" ItemID — populated either by a successful `AddItem` here or by clicking **Use** in the inventory table. State sync between the two panels goes through `useRememberedItemId` (localStorage + window CustomEvent).
- **CRUD check** — `CrudCheck.tsx`. Runs the full `AddItem → GetItem → ReviseItem → EndItem` pipeline against the configured env, with the same production guardrail.

The samples in `lib/samples.ts` are seed bodies you can edit per call. Add a new sample by adding a new key — the UI picks it up automatically. Add a call name to `DESTRUCTIVE_CALLS` in the same file to gate it the same way as Add/Revise/End.

## Known gotchas

- **`GeteBayOfficialTime` is dead in the sandbox.** eBay's edge drops the connection when that specific call name is in the `X-EBAY-API-CALL-NAME` header. It was removed from `lib/samples.ts` — use `GetUser` as your smoke test instead.
- **Developer account ≠ seller user account.** The OAuth consent screen asks the *seller* (the user who owns the listings) to grant access to the *app* (owned by your developer account). See "Two accounts, two roles" in Setup. Signing in with your developer-portal credentials at the OAuth consent screen will be rejected.
- **Sandbox tokens don't work in production (and vice versa).** OAuth tokens are scoped to one environment. After flipping `EBAY_ENV`, re-run `node scripts/ebay-oauth.mjs` to mint fresh tokens for the new environment.
- **Production calls hit real listings.** The `/api/ebay`, `/api/inventory/clear`, and `/api/crud-check` routes all 412 destructive calls (`AddItem`, `ReviseItem`, `EndItem`, etc. — see `DESTRUCTIVE_CALLS` in `lib/samples.ts`) on `EBAY_ENV=production` unless `allowProduction: true` is in the request body. The UI disables those pills entirely on production and falls back to a `window.confirm` opt-in if a destructive call is reached.
- **`GetMyeBaySelling.ActiveList` has search-index lag.** New listings can take minutes to surface there. `/api/inventory` uses `GetSellerList` instead, which queries the listing store directly and avoids the lag (it also populates `primaryCategoryName`, which `GetMyeBaySelling` leaves empty).
- **`GetSellerList` date windows are capped at 120 days.** `/api/inventory` clamps `daysAhead + daysBack ≤ 119` so the active-only mode covers up to 119 days forward, and the include-ended mode defaults to 30d back / 89d ahead.
- **OAuth tokens contain `#`.** See the env-var note above — quote them, or dotenv truncates.
- **`AddItem` sample uses category 9355 (Cell Phones).** That category requires Brand / Model / Color / Storage Capacity item specifics; they're in the sample. If you change category, expect different item-specific requirements.
- **`ListingDuration` must be `GTC`** for fixed-price listings now. eBay deprecated `Days_7` etc. for `FixedPriceItem`.

## Files of interest

| File | Purpose |
| --- | --- |
| `lib/ebay.ts` | Config loader, OAuth refresh, XML envelope builder, curl subprocess wrapper, response parser |
| `lib/samples.ts` | Inner-XML seed bodies per call name and the `DESTRUCTIVE_CALLS` set used by both server-side gating and UI disabling |
| `app/api/ebay/route.ts` | Passthrough endpoint; enforces the production opt-in for destructive calls |
| `app/api/inventory/route.ts` | Paginated `GetSellerList` reader with active-only / include-ended modes |
| `app/api/inventory/clear/route.ts` | Bulk-end every active listing; production-gated |
| `app/api/crud-check/route.ts` | 4-step CRUD verification pipeline |
| `app/components/FeedView.tsx` | Inventory table + Pull / Clear / include-ended toggle |
| `app/components/CallPanel.tsx` | Single-call passthrough UI with destructive-pill disabling on prod |
| `app/components/CrudCheck.tsx` | CRUD verification UI |
| `app/components/useRememberedItemId.ts` | Shared hook (localStorage + window CustomEvent) that links FeedView's "Use" button to CallPanel's placeholder substitution |
| `scripts/ebay-oauth.mjs` | One-time OAuth Authorization Code helper (writes tokens to `.env.local`) |

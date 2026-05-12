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

### 1. Create an eBay developer account

Sign up at https://developer.ebay.com (free). The account you sign in to the *developer portal* with is separate from the *sandbox test user* you'll sign in as during the OAuth flow — both are needed.

### 2. Create an app keyset

In the developer portal: **Application Keys → Create a keyset** (Sandbox).
Copy `App ID`, `Dev ID`, `Cert ID` into `.env.local`.

### 3. Configure an OAuth-enabled RuName

Trading-API OAuth requires a RuName (redirect URL name) with OAuth enabled on it:

1. **User Tokens → "Get a Token from eBay via Your Application"** in the developer portal.
2. Add a RuName (any auth-accepted URL works; eBay's defaults are fine for dev).
3. Make sure the OAuth-enabled column shows a green check for that RuName.
4. Copy its full name (e.g. `MyAccount-MyApp-PRD-abc12345-ab1c2def`) into `EBAY_RU_NAME` in `.env.local`.

### 4. Create a sandbox test user

The OAuth consent flow needs a *sandbox* eBay user — your developer-account credentials won't work.

- Create one at https://developer.ebay.com/sandbox/register. Throwaway email/password; not email-verified.
- Save the credentials — you'll use them every time you mint a fresh token.

### 5. Mint the OAuth tokens (one-time, via the helper script)

```bash
npm install

# Step A — open the consent URL in your browser
node scripts/ebay-oauth.mjs

# Sign in as the sandbox test user (NOT your developer.ebay.com account).
# Click "Agree and Continue".
# Copy the URL from the address bar of the resulting tab.

# Step B — exchange the code for tokens
node scripts/ebay-oauth.mjs '<paste-the-url-here>'
```

The script writes `EBAY_AUTH_TOKEN` (access, ~2h) and `EBAY_REFRESH_TOKEN` (~18mo) into `.env.local`.

You only need to re-run this when:
- The refresh token expires (~18 months)
- You want to switch to a different sandbox user
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
| `POST` | `/api/ebay` | `{ callName, xml }` | `{ ok, status, ack, errors, rawXml, parsed, endpoint, durationMs }` |
| `POST` | `/api/crud-check` | `{ allowProduction?: boolean }` | Per-step report of an `AddItem` → `GetItem` → `ReviseItem` → `EndItem` round-trip. Production is gated behind `allowProduction: true` since it publishes a real listing. |

The `xml` field is the **inner** body — the server wraps it in `<CallNameRequest>`. If you pass a full envelope (e.g., `<GetItemRequest>…</GetItemRequest>`), it's used as-is.

## UI

`/` renders `CallPanel.tsx`, which:
- Shows a pill button per call name from `lib/samples.ts`
- Lets you edit the inner XML before sending
- Displays HTTP status, duration, eBay `Ack`, raw XML, parsed JSON, and a structured error list

The samples in `lib/samples.ts` are seed bodies you can edit per call. Add a new sample by adding a new key — the UI picks it up automatically.

## Known gotchas

- **`GeteBayOfficialTime` is dead in the sandbox.** eBay's edge drops the connection when that specific call name is in the `X-EBAY-API-CALL-NAME` header. It was removed from `lib/samples.ts` — use `GetUser` as your smoke test instead.
- **Sandbox sign-in ≠ developer.ebay.com sign-in.** Token minting (whether via the helper script or the developer portal UI) requires a **sandbox test user**. Your real eBay/developer account credentials will be rejected.
- **OAuth tokens contain `#`.** See the env-var note above — quote them, or dotenv truncates.
- **`AddItem` sample uses category 9355 (Cell Phones).** That category requires Brand / Model / Color / Storage Capacity item specifics; they're in the sample. If you change category, expect different item-specific requirements.
- **`ListingDuration` must be `GTC`** for fixed-price listings now. eBay deprecated `Days_7` etc. for `FixedPriceItem`.

## Files of interest

| File | Purpose |
| --- | --- |
| `lib/ebay.ts` | Config loader, OAuth refresh, XML envelope builder, curl subprocess wrapper, response parser |
| `lib/samples.ts` | Inner-XML seed bodies per call name |
| `app/api/ebay/route.ts` | The passthrough endpoint |
| `app/api/crud-check/route.ts` | 4-step CRUD verification pipeline |
| `app/components/CallPanel.tsx` | Browser UI |
| `scripts/ebay-oauth.mjs` | One-time OAuth Authorization Code helper (writes tokens to `.env.local`) |

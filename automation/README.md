# ebay-best-offer-automation

Background service that automates eBay Best Offer responses for the Legacy
Cardz seller account, based on a versioned, fee-aware rule set with an
append-only audit trail.

This lives as a sibling subdirectory of the read-only `ebay-passthru` Next.js
app in the parent of this folder. The two share an eBay seller account but are
otherwise independent. Once the API surface solidifies, this directory is
intended to extract to its own repo (`samlegacycardz/ebay-best-offer-automation`)
via `git subtree split` — no in-place rewrites needed.

## Architecture (target)

- **Cloud Run** (single service for v0; possible split later):
  - `POST /webhooks/ebay` — SOAP BestOffer notification ingress (low-latency)
  - `POST /jobs/reconcile` — Cloud Scheduler poll for `GetBestOffers Active`
  - `GET/POST /admin/rules` — Versioned rule sets (draft / published)
  - `GET/POST /admin/fees` — Fee profile editor
  - `GET /admin/history` — Offer decision audit feed (filter + CSV)
- **Cloud SQL Postgres** — rule sets, fee profiles, append-only `offer_decision`
- **Secret Manager** — eBay OAuth refresh token + app keys
- **Cloud Scheduler** — fires the reconciliation poll on a cadence
- **Artifact Registry** + **Cloud Build** — image build / push pipeline
- **Cloud Logging** + Error Reporting — structured logs with `severity`

## Stack

- Node.js 22 LTS, TypeScript (strict, ESM)
- **Hono** for HTTP — Cloud Run native, no Vercel/Next coupling
- **Drizzle ORM** + `postgres` driver
- **fast-xml-parser** for the SOAP body
- **pino** for Cloud Logging-flavored structured logs
- **zod** for env + payload validation
- **Vitest** for tests

## Local development

```bash
cd automation
cp .env.example .env.local      # fill DATABASE_URL + eBay creds
npm install
npm run db:migrate              # apply schema migrations
npm run dev                     # http://localhost:8080
```

```bash
# verify
curl localhost:8080/healthz
```

## Deploy (first time)

```bash
export PROJECT_ID=<your-gcp-project>
export REGION=us-central1

./infra/gcloud/bootstrap.sh     # one-shot: enable APIs, SAs, Cloud SQL
./infra/gcloud/secrets.sh       # seed Secret Manager from .env.local (TODO)
./infra/gcloud/deploy.sh        # build + push + Cloud Run deploy
./infra/gcloud/scheduler.sh     # wire reconciliation cron (TODO)
```

Subsequent deploys: `./infra/gcloud/deploy.sh` only.

See `docs/RUNBOOK.md` (TODO) for rotations, debugging, and rollback.

## What's NOT in this scaffold yet

These are deliberate v0 omissions, called out so the missing surface is
**explicit, not implied**:

- Admin UI — server-rendered HTML or a small frontend; TBD
- Authentication on `/admin/*` — placeholder shared bearer for v0, SSO later
- Cloud Tasks / Pub/Sub fan-out — in-process queue for v0
- Terraform IaC — gcloud bash scripts for v0
- Reconciliation poller body — endpoint exists, polling logic TBD
- **OfferContext assembly in `routes/notifications.ts`** — the receiver still
  just logs + 200s. Building a complete `OfferContext` (listingPrice via
  `GetItem`, comps from a TBD source, grade from item specifics) and calling
  `processOffer(...)` is the next wire-up step. Pipeline + deps factory are
  ready and tested.
- **Integration tests against real Postgres** — `tests/db/queries.test.ts`
  unit-tests the query shapes against a fake Drizzle. A `tests/integration/`
  directory will hold tests gated on `DATABASE_URL` pointing at an empty
  test database. Not wired into CI yet.

The fee model, Postgres schema, env loader, logger, and project structure are
real and covered by tests.

## Repo layout

```
automation/
├── README.md
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── vitest.config.ts
├── Dockerfile
├── .dockerignore
├── .env.example
├── src/
│   ├── server.ts                # Hono app entry
│   ├── lib/
│   │   ├── env.ts               # zod-validated env loader
│   │   └── log.ts               # pino logger
│   ├── db/
│   │   ├── schema.ts            # Drizzle Postgres schema
│   │   ├── client.ts            # connection pool
│   │   ├── queries.ts           # findExistingDecision / loadActiveRuleSet /
│   │   │                        # resolvePause / insertDecision / checkDbHealth
│   │   ├── deps.ts              # buildPipelineDeps(db, cfg) factory for production
│   │   └── migrations/          # drizzle-kit-generated SQL — checked in
│   ├── domain/
│   │   ├── fees.ts              # tiered FVF + TRS discount math (real, tested)
│   │   └── ebay/                # Trading API client (real, tested)
│   │       ├── index.ts         #   re-export surface
│   │       ├── config.ts        #   EbayConfig + configIssues + endpointFor
│   │       ├── xml.ts           #   asArray / getPath / extractArray / parser
│   │       ├── curl.ts          #   curlRequest (TLS-fingerprint workaround)
│   │       └── trading.ts       #   buildRequestBody + getAccessToken + callTradingApi
│   └── routes/
│       ├── health.ts            # /healthz, /readyz
│       ├── notifications.ts     # POST /webhooks/ebay (stub)
│       ├── jobs/
│       │   └── reconcile.ts     # POST /jobs/reconcile (stub)
│       └── admin/
│           ├── rules.ts         # CRUD for rule sets (stub)
│           ├── fees.ts          # CRUD for fee profile (stub)
│           └── history.ts       # audit query (stub)
├── tests/
│   └── fees.test.ts
└── infra/
    └── gcloud/
        ├── bootstrap.sh         # project + APIs + SAs + Cloud SQL
        └── deploy.sh            # build + push + Cloud Run deploy
```

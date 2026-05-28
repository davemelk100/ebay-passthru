import CounterBidPanel from "./components/CounterBidPanel";
// import CrudCheck from "./components/CrudCheck"; // Disabled — runs AddItem / EndItem.
import FeedView from "./components/FeedView";
import LeftNav from "./components/LeftNav";
import { readConfig } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export default function Home() {
  const cfg = readConfig();

  return (
    <main className="px-6 py-10 lg:pl-56 lg:pr-8">
      <LeftNav />
      <header className="mb-8">
        <h1 className="text-3xl font-bold">eBay Inventory Sync</h1>
      </header>

      <div className="min-w-0 space-y-6">
          <section id="inventory" className="scroll-mt-6">
            <FeedView env={cfg.env} />
          </section>
          <section id="counter-bid" className="scroll-mt-6">
            <CounterBidPanel env={cfg.env} />
          </section>
          {/* <CrudCheck /> */}

          <section className="mt-10 hidden space-y-10 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            <div id="about" className="scroll-mt-6 space-y-4">
              <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
                What this app does
              </h2>
              <p>
                A read-only window into an eBay seller account. The inventory
                panel pulls active listings via the Trading API&apos;s{" "}
                <code className="font-mono text-xs">GetSellerList</code> ten at
                a time; the two passthrough panels send arbitrary read-only
                calls to the Trading API (XML in / XML out) and the Sell REST
                API (JSON in / JSON out) so you can inspect raw eBay responses
                for any item or policy.
              </p>
              <p>
                Production is locked down server-side. Trading calls are
                restricted to a small read-only allowlist —{" "}
                <code className="font-mono text-xs">GetUser</code>,{" "}
                <code className="font-mono text-xs">GetItem</code>,{" "}
                <code className="font-mono text-xs">GetSellerList</code>,{" "}
                <code className="font-mono text-xs">GetMyeBaySelling</code>.
                Every destructive call (AddItem, ReviseItem, EndItem,
                IssueRefund, LeaveFeedback, RespondToBestOffer, …) returns
                412/403 with no opt-in escape. Sell REST mutating methods
                (POST/PUT/DELETE/PATCH) and PII-leaking GET paths (
                <code className="font-mono text-xs">/sell/fulfillment/</code>,{" "}
                <code className="font-mono text-xs">/sell/finances/</code>,{" "}
                <code className="font-mono text-xs">/commerce/identity/</code>)
                are blocked too.
              </p>
              <p>
                The site is also{" "}
                <code className="font-mono text-xs">noindex</code>/
                <code className="font-mono text-xs">nofollow</code> across meta
                tag, robots.txt, and{" "}
                <code className="font-mono text-xs">X-Robots-Tag</code> header
                so it stays out of search engines and link previews.
              </p>
            </div>

            <div id="shopify" className="scroll-mt-6 space-y-4">
              <p>
                The inventory endpoint is a stable JSON feed of eBay listings —
                well-suited to drive a Shopify-side mirror without ever giving
                the consumer credentials. The fastest reliable pattern:
              </p>
              <ul className="list-disc space-y-3 pl-5">
                <li>
                  <strong>
                    Use{" "}
                    <code className="font-mono text-xs">
                      POST /api/inventory
                    </code>{" "}
                    as the feed.
                  </strong>{" "}
                  Start with{" "}
                  <code className="font-mono text-xs">
                    {"{ pageNumber: 1, entriesPerPage: 200 }"}
                  </code>{" "}
                  (200 is eBay&apos;s max — minimizes round-trips) and loop
                  while <code className="font-mono text-xs">hasMore</code> is
                  true, incrementing{" "}
                  <code className="font-mono text-xs">pageNumber</code>. Treat
                  the response as authoritative for &ldquo;currently active on
                  eBay&rdquo; — ended listings are filtered server-side.
                </li>
                <li>
                  <strong>Join on SKU, identify by ItemID.</strong> Shopify
                  variants already carry a SKU, so make{" "}
                  <code className="font-mono text-xs">item.sku</code> the join
                  key when present and fall back to{" "}
                  <code className="font-mono text-xs">item.itemId</code> (stable
                  across title/price edits). Store the ItemID on the Shopify
                  variant as a metafield (e.g.{" "}
                  <code className="font-mono text-xs">ebay.item_id</code>) so
                  future syncs reuse the same mapping.
                </li>
                <li>
                  <strong>Diff before writing.</strong> Cache the last-seen
                  payload (S3, KV, Postgres — anything cheap) keyed by ItemID
                  and only push to Shopify when{" "}
                  <code className="font-mono text-xs">quantity</code>,{" "}
                  <code className="font-mono text-xs">price</code>,{" "}
                  <code className="font-mono text-xs">listingStatus</code>, or{" "}
                  <code className="font-mono text-xs">title</code> actually
                  change. Shopify&apos;s Admin API is rate-limited; a
                  no-op-on-no-change sync keeps you well under the bucket.
                </li>
                <li>
                  <strong>Run it on a cron, not a webhook.</strong> eBay
                  doesn&apos;t push change events for Trading-API listings, and
                  seller inventory rarely changes minute-to-minute. A scheduled
                  job every 15–60 minutes (Shopify Flow, a Vercel Cron, or a
                  small worker) is the right cadence. Each full pull of ~3k
                  listings finishes in under a minute at 200/page.
                </li>
                <li>
                  <strong>Mirror, don&apos;t reverse-sync.</strong> This app is
                  read-only by design — every write to eBay is hard-blocked. The
                  Shopify side is the system of record for store-only product
                  data (descriptions, variants, collections); this feed is the
                  system of record for what&apos;s actually listed on eBay right
                  now. Don&apos;t try to update eBay from Shopify through here —
                  call eBay&apos;s Sell APIs directly with your own keyset for
                  that.
                </li>
                <li>
                  <strong>Reconcile ended listings.</strong> Anything that was
                  present in a previous pull and is missing from the current one
                  is either sold or ended. Treat &ldquo;disappeared from
                  feed&rdquo; as an event and either mark the Shopify variant
                  out-of-stock or hide it, depending on whether the SKU has
                  remaining inventory elsewhere.
                </li>
              </ul>
            </div>
          </section>
        </div>
      </main>
  );
}

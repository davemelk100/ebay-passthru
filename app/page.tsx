import CallPanel from "./components/CallPanel";
// import CounterBidPanel from "./components/CounterBidPanel"; // Disabled — would mutate buyer offers.
// import CrudCheck from "./components/CrudCheck"; // Disabled — runs AddItem / EndItem.
import FeedView from "./components/FeedView";
import SellPanel from "./components/SellPanel";
import { readConfig } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export default function Home() {
  const cfg = readConfig();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">eBay Passthru</h1>
      </header>

      <div className="space-y-6">
        <FeedView env={cfg.env} />
        <CallPanel env={cfg.env} />
        {/* <CounterBidPanel env={cfg.env} /> */}
        <SellPanel env={cfg.env} />
        {/* <CrudCheck /> */}
      </div>

      <section className="mt-10 space-y-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        <h2 className="text-base font-semibold text-neutral-700 dark:text-neutral-200">
          What this app does
        </h2>
        <p>
          A read-only window into an eBay seller account. The inventory panel pulls active
          listings via the Trading API&apos;s <code className="font-mono text-xs">GetSellerList</code>{" "}
          ten at a time; the two passthrough panels send arbitrary read-only calls to the
          Trading API (XML in / XML out) and the Sell REST API (JSON in / JSON out) so you can
          inspect raw eBay responses for any item or policy.
        </p>
        <p>
          Production is locked down server-side. Trading calls are restricted to a small
          read-only allowlist —{" "}
          <code className="font-mono text-xs">GetUser</code>,{" "}
          <code className="font-mono text-xs">GetItem</code>,{" "}
          <code className="font-mono text-xs">GetSellerList</code>,{" "}
          <code className="font-mono text-xs">GetMyeBaySelling</code>. Every destructive call
          (AddItem, ReviseItem, EndItem, IssueRefund, LeaveFeedback, RespondToBestOffer, …)
          returns 412/403 with no opt-in escape. Sell REST mutating methods (POST/PUT/DELETE/PATCH)
          and PII-leaking GET paths (<code className="font-mono text-xs">/sell/fulfillment/</code>,{" "}
          <code className="font-mono text-xs">/sell/finances/</code>,{" "}
          <code className="font-mono text-xs">/commerce/identity/</code>) are blocked too.
        </p>
        <p>
          The site is also <code className="font-mono text-xs">noindex</code>/<code className="font-mono text-xs">nofollow</code>{" "}
          across meta tag, robots.txt, and <code className="font-mono text-xs">X-Robots-Tag</code> header
          so it stays out of search engines and link previews.
        </p>
      </section>
    </main>
  );
}

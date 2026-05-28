import CallPanel from "./components/CallPanel";
// import CounterBidPanel from "./components/CounterBidPanel"; // Disabled — would mutate buyer offers.
// import CrudCheck from "./components/CrudCheck"; // Disabled — runs AddItem / EndItem.
import FeedView from "./components/FeedView";
import SellPanel from "./components/SellPanel";
import { configIssues, readConfig } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export default function Home() {
  const cfg = readConfig();
  const missing = configIssues(cfg);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">eBay Passthru</h1>
        <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <span>
            env: <strong>{cfg.env}</strong>
          </span>
          <span>·</span>
          <span>siteId: {cfg.siteId}</span>
          <span>·</span>
          <span>compat: {cfg.compatLevel}</span>
          {missing.length > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-600">missing: {missing.join(", ")}</span>
            </>
          )}
        </div>
      </header>

      <div className="space-y-6">
        <FeedView env={cfg.env} />
        <CallPanel env={cfg.env} />
        {/* <CounterBidPanel env={cfg.env} /> */}
        <SellPanel env={cfg.env} />
        {/* <CrudCheck /> */}
      </div>
    </main>
  );
}

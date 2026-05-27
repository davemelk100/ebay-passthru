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
  const endpoint =
    cfg.env === "production"
      ? "https://api.ebay.com/ws/api.dll"
      : "https://api.sandbox.ebay.com/ws/api.dll";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold">eBay Passthru</h1>
          <div className="flex flex-col items-end text-right">
            <a
              href="https://github.com/davemelk100/ebay-passthru"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-neutral-500 hover:text-neutral-700 hover:underline dark:hover:text-neutral-200"
            >
              github.com/davemelk100/ebay-passthru
            </a>
            <span className="mt-1 text-xs text-neutral-500">
              Trading API endpoint: <code>{endpoint}</code>
            </span>
          </div>
        </div>
        <p className="text-neutral-500">
          Inspect an eBay Trading API feed and verify CRUD operations end-to-end.
        </p>
        <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <span>
            env: <strong>{cfg.env}</strong>
          </span>
          <span>·</span>
          <span>siteId: {cfg.siteId}</span>
          <span>·</span>
          <span>compat: {cfg.compatLevel}</span>
          <span>·</span>
          {missing.length > 0 ? (
            <span className="text-amber-600">missing: {missing.join(", ")}</span>
          ) : (
            <span className="text-green-600">credentials loaded</span>
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

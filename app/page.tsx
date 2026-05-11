import CallPanel from "./components/CallPanel";
import CrudCheck from "./components/CrudCheck";
import FeedView from "./components/FeedView";
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
        <h1 className="text-3xl font-bold">eBay Passthru</h1>
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
        <FeedView />
        <CallPanel />
        <CrudCheck />
      </div>

      <footer className="mt-10 text-xs text-neutral-500">
        Trading API endpoint: <code>{endpoint}</code>
      </footer>
    </main>
  );
}

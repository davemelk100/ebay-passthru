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
    </main>
  );
}

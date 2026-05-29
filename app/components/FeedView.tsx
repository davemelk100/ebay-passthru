"use client";

import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRememberedItemId } from "./useRememberedItemId";
import { useApiCall } from "./useApiCall";
import type {
  InventoryItem,
  InventoryResult,
  NotificationEvent,
  RecentNotificationsResult,
  ShopifyCatalogResult,
  ShopifyProduct,
  SubscriptionsResult,
} from "@/lib/types";

const DEFAULT_PAGE_SIZE = 50;
// 0 is the sentinel for "show all" — every render path special-cases it.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 150, 200, 250, 0];
const FETCH_PAGE_SIZE = 200; // server-side fetch page size (eBay max for GetSellerList)
const PREFETCH_CONCURRENCY = 4;
const CACHE_KEY_PREFIX = "ebay-inventory-v1";
// Stale-while-revalidate window: we'll always show whatever's cached, but if
// it's older than this we kick off a silent background refresh.
const CACHE_STALE_AFTER_MS = 10 * 60 * 1000; // 10 minutes

interface CachedInventory {
  items: InventoryItem[];
  pull: InventoryResult;
  timestamp: number;
}

function cacheKey(includeEnded: boolean): string {
  return `${CACHE_KEY_PREFIX}:${includeEnded ? "all" : "active"}`;
}

function loadCachedInventory(includeEnded: boolean): CachedInventory | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(includeEnded));
    if (!raw) return null;
    // No TTL gate here — caller decides whether to background-refresh based
    // on the embedded timestamp. Always showing stale beats showing nothing.
    return JSON.parse(raw) as CachedInventory;
  } catch {
    return null;
  }
}

function saveCachedInventory(
  includeEnded: boolean,
  items: InventoryItem[],
  pull: InventoryResult,
): void {
  if (typeof window === "undefined") return;
  try {
    // Strip everything we don't render. pictureUrls in particular blows up
    // the cache (each item can carry 5+ ~150-char URLs and only the first is
    // ever shown on mobile). Cuts the serialized payload by ~60–70%, which
    // matters because JSON.parse on a 5MB+ string blocks the main thread on
    // every page load.
    const slim: InventoryItem[] = items.map((it) => ({
      ...it,
      pictureUrls: it.pictureUrls.slice(0, 1),
    }));
    window.localStorage.setItem(
      cacheKey(includeEnded),
      JSON.stringify({ items: slim, pull, timestamp: Date.now() } as CachedInventory),
    );
  } catch {
    /* quota exceeded / storage disabled — skip caching, don't break the page */
  }
}
const RECENT_POLL_MS = 15000;
const BID_EVENT_NAMES = new Set(["BidPlaced", "BidReceived", "BestOfferPlaced"]);

function formatTimeAgo(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Module-level cache of Intl.NumberFormat instances. Constructing the
// formatter is the expensive part — reusing it per currency code makes the
// table's price column render essentially free.
const priceFormatters = new Map<string, Intl.NumberFormat>();
const FALLBACK_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPrice(price: string, currency: string): string {
  const n = Number.parseFloat(price);
  if (!Number.isFinite(n)) return `${price} ${currency}`.trim();
  const code = currency || "USD";
  let fmt = priceFormatters.get(code);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    } catch {
      fmt = FALLBACK_FORMATTER;
    }
    priceFormatters.set(code, fmt);
  }
  return fmt.format(n);
}

export default function FeedView(_props: { env: "sandbox" | "production" }) {
  void _props;
  const {
    data: pull,
    error: pullError,
    loading: pullLoading,
    run: runPull,
    setData: setPull,
  } = useApiCall<InventoryResult>();
  const [rememberedItemId, setRememberedItemId] = useRememberedItemId();
  const [includeEnded, setIncludeEnded] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recent, setRecent] = useState<RecentNotificationsResult | null>(null);
  const [subs, setSubs] = useState<SubscriptionsResult | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const [shopify, setShopify] = useState<Record<string, ShopifyProduct>>({});
  const [takeActionOpen, setTakeActionOpen] = useState(false);
  const seenEventIds = useRef<Set<string>>(new Set());
  const firstPollDone = useRef(false);

  // ---------- Inventory pull ----------
  // Client-side pagination over the accumulated items array.
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [prefetching, setPrefetching] = useState(false);
  // Bumped on each load cycle so an in-flight prefetch can cancel cleanly when
  // includeEnded flips or a manual refresh is triggered.
  const prefetchRunId = useRef(0);

  const pullFirst = useCallback(
    async (opts?: { silent?: boolean }) => {
      prefetchRunId.current += 1;
      const myId = prefetchRunId.current;
      setItems([]);
      setCurrentPage(1);
      const first = await runPull(
        "/api/inventory",
        { pageNumber: 1, entriesPerPage: FETCH_PAGE_SIZE, includeEnded },
        { silent: opts?.silent },
      );
      if (myId !== prefetchRunId.current) return;
      if (!first?.ok || !first.items) {
        setItems([]);
        return;
      }
      // Local accumulator so the final cache write sees every page, regardless
      // of which parallel worker landed it.
      const accumulated: InventoryItem[] = [...first.items];
      setItems(first.items);
      const total = first.totalPages ?? 0;
      if (total <= 1) {
        saveCachedInventory(includeEnded, accumulated, first);
        return;
      }
      setPrefetching(true);
      const queue = Array.from({ length: total - 1 }, (_, i) => i + 2);
      let cursor = 0;
      async function worker() {
        while (true) {
          const idx = cursor++;
          if (idx >= queue.length) return;
          const pageNumber = queue[idx];
          if (myId !== prefetchRunId.current) return;
          try {
            const res = await fetch("/api/inventory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                pageNumber,
                entriesPerPage: FETCH_PAGE_SIZE,
                includeEnded,
              }),
            });
            const data = (await res.json()) as InventoryResult;
            if (myId !== prefetchRunId.current) return;
            if (data.ok && data.items) {
              accumulated.push(...data.items);
              // Mark prefetch fan-in as a low-priority transition so React
              // can keep the UI (sort clicks, pagination, modal) responsive
              // through ~17 incremental setItems calls.
              startTransition(() => {
                setItems((prev) => [...prev, ...data.items!]);
              });
            }
          } catch {
            /* network blip — skip this page, continue */
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, () => worker()),
      );
      if (myId === prefetchRunId.current) {
        setPrefetching(false);
        saveCachedInventory(includeEnded, accumulated, first);
      }
    },
    [includeEnded, runPull],
  );

  useEffect(() => {
    if (pull !== null) pullFirst({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeEnded]);

  const autoPullDone = useRef(false);
  useEffect(() => {
    if (autoPullDone.current) return;
    autoPullDone.current = true;
    const cached = loadCachedInventory(includeEnded);
    if (cached) {
      // Stale-while-revalidate: render the cache instantly so the page is
      // usable, then quietly refresh in the background if it's stale.
      setItems(cached.items);
      setPull(cached.pull);
      const ageMs = Date.now() - cached.timestamp;
      if (ageMs > CACHE_STALE_AFTER_MS) pullFirst({ silent: true });
      return;
    }
    pullFirst({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map of itemId → all live events for that item, newest first. Drives the
  // per-row inline event strip; the bubble-up sort uses the head element.
  const eventsByItemId: Map<string, NotificationEvent[]> = useMemo(() => {
    const m = new Map<string, NotificationEvent[]>();
    for (const e of recent?.events ?? []) {
      if (!e.itemId) continue;
      const arr = m.get(e.itemId);
      if (arr) arr.push(e);
      else m.set(e.itemId, [e]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    }
    return m;
  }, [recent]);

  const latestEventByItemId: Map<string, NotificationEvent> = useMemo(() => {
    const m = new Map<string, NotificationEvent>();
    for (const [id, arr] of eventsByItemId) m.set(id, arr[0]);
    return m;
  }, [eventsByItemId]);

  // User-selected column sort overrides the default activity-bubble. Set null
  // to fall back to "items with recent events / bids float to the top".
  type SortColumn =
    | "itemId"
    | "title"
    | "sku"
    | "quantity"
    | "quantitySold"
    | "price"
    | "listingStatus"
    | "primaryCategoryName"
    | "listingType"
    | "startTime";
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
    setCurrentPage(1);
  }

  const sortedItems = useMemo(() => {
    if (sortColumn !== null) {
      const dir = sortDir === "asc" ? 1 : -1;
      return [...items].sort((a, b) => {
        const av = a[sortColumn];
        const bv = b[sortColumn];
        // Numeric columns: compare as Number. Price arrives as a string from
        // the API but the table treats it like a number.
        if (sortColumn === "quantity" || sortColumn === "quantitySold") {
          return dir * (Number(av) - Number(bv));
        }
        if (sortColumn === "price") {
          return dir * (Number.parseFloat(String(av)) - Number.parseFloat(String(bv)));
        }
        return dir * String(av).localeCompare(String(bv));
      });
    }
    if (latestEventByItemId.size === 0) return items;
    return [...items].sort((a, b) => {
      const aEv = latestEventByItemId.get(a.itemId);
      const bEv = latestEventByItemId.get(b.itemId);
      const aActivity = aEv !== undefined ? 1 : 0;
      const bActivity = bEv !== undefined ? 1 : 0;
      if (aActivity !== bActivity) return bActivity - aActivity;
      if (aEv && bEv) return Date.parse(bEv.timestamp) - Date.parse(aEv.timestamp);
      if (aEv) return -1;
      if (bEv) return 1;
      return 0;
    });
  }, [items, latestEventByItemId, sortColumn, sortDir]);

  const showingAll = pageSize === 0;
  const totalPagesClient = showingAll
    ? 1
    : Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const displayedItems = useMemo(
    () =>
      showingAll
        ? sortedItems
        : sortedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedItems, currentPage, pageSize, showingAll],
  );

  // ---------- Webhook live-events poll (15s) ----------
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/offers/recent", { cache: "no-store" });
        const json = (await r.json()) as RecentNotificationsResult;
        if (cancelled) return;
        setRecent(json);
        const incoming = json.events ?? [];
        if (!firstPollDone.current) {
          for (const ev of incoming) seenEventIds.current.add(ev.id);
          firstPollDone.current = true;
          return;
        }
        if (typeof Notification === "undefined" || Notification.permission !== "granted") {
          for (const ev of incoming) seenEventIds.current.add(ev.id);
          return;
        }
        for (const ev of incoming) {
          if (seenEventIds.current.has(ev.id)) continue;
          seenEventIds.current.add(ev.id);
          if (!BID_EVENT_NAMES.has(ev.eventName)) continue;
          const priceLine =
            ev.offerPrice !== undefined
              ? `${ev.offerPrice} ${ev.currency || ""}${ev.quantity ? ` × ${ev.quantity}` : ""}`
              : "";
          const buyerLine = ev.buyerUserId ? ` from ${ev.buyerUserId}` : "";
          const body = [priceLine + buyerLine, ev.title].filter(Boolean).join(" — ");
          new Notification(`eBay: ${ev.eventName}`, { body: body || undefined, tag: ev.id });
        }
      } catch {
        /* network blip — keep last snapshot */
      }
    }
    tick();
    const id = setInterval(tick, RECENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/offers/subscriptions", { cache: "no-store" })
      .then((r) => r.json() as Promise<SubscriptionsResult>)
      .then((json) => {
        if (!cancelled) setSubs(json);
      })
      .catch(() => {
        /* keep null */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setNotifPermission("unsupported");
      return;
    }
    setNotifPermission(Notification.permission);
  }, []);

  // One-shot Shopify public catalog pull on mount. Server-cached in Upstash
  // for 24h so this is cheap; failure mode is "no Shopify columns populate"
  // which is graceful — the rest of the view is unaffected.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/shopify/catalog", { cache: "no-store" })
      .then((r) => r.json() as Promise<ShopifyCatalogResult>)
      .then((json) => {
        if (!cancelled && json.ok && json.map) setShopify(json.map);
      })
      .catch(() => {
        /* network blip — leave map empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  // ESC closes the placeholder "take action" modal — standard expectation.
  useEffect(() => {
    if (!takeActionOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTakeActionOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [takeActionOpen]);

  const events: NotificationEvent[] = recent?.events ?? [];

  function Pagination() {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <label className="inline-flex items-center gap-1 text-xs text-neutral-500">
          <span>Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "All" : n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          ← Prev
        </button>
        <span className="text-xs text-neutral-500">
          Page <strong className="text-neutral-700 dark:text-neutral-200">{currentPage}</strong>{" "}
          of {totalPagesClient}
          {prefetching && (
            <span className="ml-2 inline-flex items-center gap-1 text-neutral-400">
              <svg
                className="h-3 w-3 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  className="opacity-25"
                />
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
              loading {sortedItems.length}/{pull?.totalEntries ?? "?"}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setCurrentPage((p) => Math.min(totalPagesClient, p + 1))}
          disabled={currentPage >= totalPagesClient}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Next →
        </button>
      </div>
    );
  }

  function SortHeader({ col, label }: { col: SortColumn; label: string }) {
    const active = sortColumn === col;
    return (
      <th
        scope="col"
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => toggleSort(col)}
        className="cursor-pointer select-none px-2 py-1 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        {label}
        {active && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </th>
    );
  }

  return (
    <>
    <details open className="group rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="flex cursor-pointer list-none items-center justify-between p-4 [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold">Listings & bids</h2>
        <span className="text-xs text-neutral-500">
          {pull?.totalEntries !== undefined
            ? `${items.length} / ${pull.totalEntries}`
            : "GetSellerList"}
        </span>
      </summary>
      <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        {subs?.applicationEnabled === false && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            Webhook delivery is OFF — run{" "}
            <code className="font-mono">node scripts/setup-notifications.mjs</code> to subscribe.
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-neutral-500">
            Auto-loaded ({showingAll ? "all rows" : `${pageSize} per page`}) — items with recent activity float to the top.
            {events.length > 0 && (
              <span className="ml-1 text-neutral-400">
                · {events.length} live event{events.length === 1 ? "" : "s"} buffered (
                {recent?.backend ?? "—"})
              </span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {notifPermission === "default" && (
              <button
                type="button"
                onClick={enableNotifications}
                className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300"
              >
                Enable bid alerts
              </button>
            )}
            {notifPermission === "granted" && (
              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                Bid alerts on
              </span>
            )}
            {notifPermission === "denied" && (
              <span className="rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900">
                Alerts blocked
              </span>
            )}
            <label className="inline-flex cursor-pointer select-none items-center gap-2">
              <span className="text-xs text-neutral-500">include ended/sold</span>
              <input
                type="checkbox"
                checked={includeEnded}
                onChange={(e) => setIncludeEnded(e.target.checked)}
                disabled={pullLoading}
                className="peer sr-only"
              />
              <span className="relative h-5 w-9 rounded-full bg-neutral-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-disabled:opacity-50 dark:bg-neutral-700" />
            </label>
          </div>
        </div>

        {!pull && !pullError && (pullLoading || items.length === 0) ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-neutral-500">
            <svg
              className="h-8 w-8 animate-spin text-blue-600"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                className="opacity-25"
              />
              <path
                d="M22 12a10 10 0 0 1-10 10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span>Loading inventory…</span>
          </div>
        ) : null}

        {/* Background activity banner — shows whenever inventory is being
            refreshed silently (stale cache revalidation) or pages are
            streaming in via prefetch, while data is already visible. */}
        {(pull || items.length > 0) && (pullLoading || prefetching) ? (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
            <svg
              className="h-4 w-4 flex-shrink-0 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                className="opacity-25"
              />
              <path
                d="M22 12a10 10 0 0 1-10 10"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span>
              {prefetching
                ? `Loading ${sortedItems.length}${pull?.totalEntries ? ` of ${pull.totalEntries}` : ""} listings…`
                : "Refreshing inventory…"}
            </span>
          </div>
        ) : null}

        {pull || pullError ? (
          <div className="mb-3">
            {pullError || pull?.error || pull?.missing ? (
              <p className="text-xs text-red-600">
                {pullError ?? pull?.error ?? "Missing env vars: " + (pull?.missing ?? []).join(", ")}
              </p>
            ) : pull ? (
              <>
                <div className="mb-2 flex flex-wrap gap-3 text-xs text-neutral-500">
                  <span>
                    Loaded: <strong className="text-neutral-700 dark:text-neutral-200">{items.length}</strong>
                    {typeof pull.totalEntries === "number" && pull.totalEntries > items.length
                      ? ` of ${pull.totalEntries}`
                      : ""}
                  </span>
                  <span>·</span>
                  <span>
                    Showing {showingAll ? 1 : (currentPage - 1) * pageSize + 1}–
                    {showingAll
                      ? sortedItems.length
                      : Math.min(currentPage * pageSize, sortedItems.length)} of {sortedItems.length}
                  </span>
                  {sortColumn && (
                    <>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSortColumn(null);
                          setCurrentPage(1);
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        clear sort
                      </button>
                    </>
                  )}
                </div>
                {items.length > 0 ? (
                  <div>
                    <div className="mb-3">
                      <Pagination />
                    </div>
                    {/* Desktop / tablet: data table */}
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase text-neutral-500">
                          <tr>
                            <SortHeader col="title" label="Listing title" />
                            <SortHeader col="sku" label="SKU" />
                            <SortHeader col="price" label="eBay list price" />
                            <SortHeader col="listingStatus" label="Status" />
                            <th className="px-2 py-1">Shopify created</th>
                            <th className="px-2 py-1">Shopify sticker</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayedItems.map((it) => {
                            const isSelected = rememberedItemId === it.itemId;
                            const evs = eventsByItemId.get(it.itemId);
                            const sp = shopify[it.sku];
                            return (
                              <Fragment key={it.itemId}>
                              <tr
                                className={`border-t border-neutral-100 dark:border-neutral-800 ${
                                  isSelected
                                    ? "bg-blue-50 shadow-[0_0_10px_2px_rgba(96,165,250,0.45)] dark:bg-blue-950/30 dark:shadow-[0_0_10px_2px_rgba(96,165,250,0.35)]"
                                    : ""
                                }`}
                              >
                                <td className="px-2 py-1">
                                  {it.viewItemUrl ? (
                                    <a
                                      href={it.viewItemUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline"
                                    >
                                      {it.title}
                                    </a>
                                  ) : (
                                    it.title
                                  )}
                                </td>
                                <td className="px-2 py-1 font-mono text-sm">{it.sku}</td>
                                <td className="px-2 py-1">{formatPrice(it.price, it.currency)}</td>
                                <td className="px-2 py-1 text-xs">
                                  {evs && evs.length > 0 ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                        Bidded
                                      </span>
                                      <span className="text-neutral-400">
                                        {it.listingStatus || ""}
                                      </span>
                                    </span>
                                  ) : (
                                    <span
                                      className={
                                        it.listingStatus === "Active"
                                          ? "text-green-700 dark:text-green-400"
                                          : "text-neutral-500"
                                      }
                                    >
                                      {it.listingStatus || "—"}
                                    </span>
                                  )}
                                </td>
                                <td
                                  className="px-2 py-1 text-xs"
                                  title={sp ? formatDateTime(sp.created_at) : undefined}
                                >
                                  {sp ? formatDate(sp.created_at) : <span className="text-neutral-400">—</span>}
                                </td>
                                <td className="px-2 py-1">
                                  {sp ? formatPrice(sp.price, "USD") : <span className="text-neutral-400">—</span>}
                                </td>
                              </tr>
                              {evs && evs.length > 0 && (
                                <tr
                                  className={`border-t border-neutral-100 dark:border-neutral-800 ${
                                    isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                                  }`}
                                >
                                  <td colSpan={6} className="px-2 pb-2 pt-0">
                                    <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
                                      <button
                                        type="button"
                                        onClick={() => setTakeActionOpen(true)}
                                        className="flex-shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600"
                                      >
                                        Take action →
                                      </button>
                                      <ul className="flex-1 space-y-0.5">
                                        {evs.map((e) => (
                                          <li
                                            key={e.id}
                                            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                                          >
                                            <span
                                              className="font-mono text-neutral-500"
                                              title={formatDateTime(e.timestamp)}
                                            >
                                              {formatTimeAgo(e.timestamp)}
                                            </span>
                                            <strong className="text-amber-800 dark:text-amber-300">
                                              {e.eventName}
                                            </strong>
                                            {e.offerPrice !== undefined && (
                                              <span>
                                                {e.offerPrice} {e.currency || ""}
                                                {e.quantity ? ` × ${e.quantity}` : ""}
                                              </span>
                                            )}
                                            {e.buyerUserId && (
                                              <span className="font-mono">
                                                from {e.buyerUserId}
                                              </span>
                                            )}
                                            {e.signatureValid === false && (
                                              <span className="text-amber-600">⚠ unsigned</span>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile: one <dl> per listing */}
                    <ul className="space-y-3 md:hidden">
                      {displayedItems.map((it) => {
                        const isSelected = rememberedItemId === it.itemId;
                        const evs = eventsByItemId.get(it.itemId);
                        const sp = shopify[it.sku];
                        return (
                          <li
                            key={it.itemId}
                            className={`rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800 ${
                              isSelected
                                ? "bg-blue-50 shadow-[0_0_10px_2px_rgba(96,165,250,0.45)] dark:bg-blue-950/30 dark:shadow-[0_0_10px_2px_rgba(96,165,250,0.35)]"
                                : ""
                            }`}
                          >
                            <div>
                              <div className="min-w-0 flex-1">
                                <p className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                                  {it.viewItemUrl ? (
                                    <a
                                      href={it.viewItemUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline"
                                    >
                                      {it.title}
                                    </a>
                                  ) : (
                                    it.title
                                  )}
                                </p>
                                {evs && evs.length > 0 && (
                                  <div className="mb-2 flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
                                    <button
                                      type="button"
                                      onClick={() => setTakeActionOpen(true)}
                                      className="flex-shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600"
                                    >
                                      Take action →
                                    </button>
                                    <ul className="flex-1 space-y-0.5">
                                      {evs.map((e) => (
                                        <li
                                          key={e.id}
                                          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                                        >
                                          <span
                                            className="font-mono text-neutral-500"
                                            title={formatDateTime(e.timestamp)}
                                          >
                                            {formatTimeAgo(e.timestamp)}
                                          </span>
                                          <strong className="text-amber-800 dark:text-amber-300">
                                            {e.eventName}
                                          </strong>
                                          {e.offerPrice !== undefined && (
                                            <span>
                                              {e.offerPrice} {e.currency || ""}
                                              {e.quantity ? ` × ${e.quantity}` : ""}
                                            </span>
                                          )}
                                          {e.buyerUserId && (
                                            <span className="font-mono">
                                              from {e.buyerUserId}
                                            </span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                                  {it.sku && (
                                    <>
                                      <dt className="text-neutral-500">SKU</dt>
                                      <dd className="font-mono text-sm">{it.sku}</dd>
                                    </>
                                  )}
                                  <dt className="text-neutral-500">eBay list price</dt>
                                  <dd>{formatPrice(it.price, it.currency)}</dd>
                                  <dt className="text-neutral-500">Status</dt>
                                  <dd>
                                    {evs && evs.length > 0 ? (
                                      <span className="inline-flex items-center gap-1">
                                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                          Bidded
                                        </span>
                                        <span className="text-neutral-400">
                                          {it.listingStatus || ""}
                                        </span>
                                      </span>
                                    ) : (
                                      <span
                                        className={
                                          it.listingStatus === "Active"
                                            ? "text-green-700 dark:text-green-400"
                                            : "text-neutral-500"
                                        }
                                      >
                                        {it.listingStatus || "—"}
                                      </span>
                                    )}
                                  </dd>
                                  <dt className="text-neutral-500">Shopify created</dt>
                                  <dd title={sp ? formatDateTime(sp.created_at) : undefined}>
                                    {sp ? (
                                      formatDate(sp.created_at)
                                    ) : (
                                      <span className="text-neutral-400">—</span>
                                    )}
                                  </dd>
                                  <dt className="text-neutral-500">Shopify sticker</dt>
                                  <dd>
                                    {sp ? (
                                      formatPrice(sp.price, "USD")
                                    ) : (
                                      <span className="text-neutral-400">—</span>
                                    )}
                                  </dd>
                                </dl>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="mt-3">
                      <Pagination />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">No items returned.</p>
                )}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
    {takeActionOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
        onClick={() => setTakeActionOpen(false)}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="relative w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setTakeActionOpen(false)}
            aria-label="Close"
            className="absolute -right-2 -top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-xl font-medium text-neutral-700 shadow-lg hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            ×
          </button>
          <div className="flex flex-col items-center text-center">
            <span className="mb-3 text-4xl" aria-hidden="true">
              🚧
            </span>
            <h3 className="mb-2 text-lg font-semibold text-neutral-800 dark:text-neutral-100">
              Can&apos;t take action here yet
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Accepting, declining, or countering buyer offers can&apos;t be
              done from this view. Handle the offer directly in eBay until the
              automated response engine is wired up.
            </p>
            <button
              type="button"
              onClick={() => setTakeActionOpen(false)}
              className="mt-5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRememberedItemId } from "./useRememberedItemId";
import { useApiCall } from "./useApiCall";
import type {
  ActiveOffer,
  InventoryItem,
  InventoryResult,
  NotificationEvent,
  OffersResult,
  RecentNotificationsResult,
  SubscriptionsResult,
} from "@/lib/types";

const PAGE_SIZE = 10; // client-side display page size
const FETCH_PAGE_SIZE = 200; // server-side fetch page size (eBay max for GetSellerList)
const PREFETCH_CONCURRENCY = 4;
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

function formatExpiration(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMs = t - Date.now();
  if (diffMs <= 0) return "expired";
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export default function FeedView(_props: { env: "sandbox" | "production" }) {
  void _props;
  const {
    data: pull,
    error: pullError,
    loading: pullLoading,
    run: runPull,
    reset: resetPull,
  } = useApiCall<InventoryResult>();
  const offersCall = useApiCall<OffersResult>();
  const [rememberedItemId, setRememberedItemId] = useRememberedItemId();
  const [includeEnded, setIncludeEnded] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recent, setRecent] = useState<RecentNotificationsResult | null>(null);
  const [subs, setSubs] = useState<SubscriptionsResult | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const seenEventIds = useRef<Set<string>>(new Set());
  const firstPollDone = useRef(false);

  // ---------- Inventory pull ----------
  // Client-side pagination over the accumulated items array.
  const [currentPage, setCurrentPage] = useState(1);
  const [prefetching, setPrefetching] = useState(false);
  // Bumped on each load cycle so an in-flight prefetch can cancel cleanly when
  // includeEnded flips or the user hits "Pull active items" again.
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
      setItems(first.items);
      const total = first.totalPages ?? 0;
      if (total <= 1) return;
      setPrefetching(true);
      // Parallel workers chew through the remaining pages. Each page bumps
      // items so the user can navigate / sort as data arrives.
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
            if (data.ok && data.items) setItems((prev) => [...prev, ...data.items!]);
          } catch {
            /* network blip — skip this page, continue */
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, () => worker()),
      );
      if (myId === prefetchRunId.current) setPrefetching(false);
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
    pullFirst({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearView() {
    prefetchRunId.current += 1;
    setItems([]);
    setCurrentPage(1);
    setPrefetching(false);
    resetPull();
    offersCall.reset();
  }

  // ---------- Offers / bids pull ----------
  async function pullBids() {
    await offersCall.run("/api/offers", {});
  }

  const offersByItemId: Map<string, ActiveOffer[]> = useMemo(() => {
    const m = new Map<string, ActiveOffer[]>();
    const list = offersCall.data?.offers ?? [];
    for (const o of list) {
      const arr = m.get(o.itemId);
      if (arr) arr.push(o);
      else m.set(o.itemId, [o]);
    }
    return m;
  }, [offersCall.data]);

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
    | "listingType";
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
    if (offersByItemId.size === 0 && latestEventByItemId.size === 0) return items;
    return [...items].sort((a, b) => {
      const aEv = latestEventByItemId.get(a.itemId);
      const bEv = latestEventByItemId.get(b.itemId);
      const aActivity = aEv !== undefined || offersByItemId.has(a.itemId) ? 1 : 0;
      const bActivity = bEv !== undefined || offersByItemId.has(b.itemId) ? 1 : 0;
      if (aActivity !== bActivity) return bActivity - aActivity;
      if (aEv && bEv) return Date.parse(bEv.timestamp) - Date.parse(aEv.timestamp);
      if (aEv) return -1;
      if (bEv) return 1;
      return 0;
    });
  }, [items, offersByItemId, latestEventByItemId, sortColumn, sortDir]);

  const totalPagesClient = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const displayedItems = useMemo(
    () => sortedItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [sortedItems, currentPage],
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

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  const events: NotificationEvent[] = recent?.events ?? [];
  const offersLoading = offersCall.loading;
  const offersError = offersCall.error ?? offersCall.data?.error;
  const offerCount = offersCall.data?.offerCount;
  const itemsWithOffers = offersCall.data?.itemsWithOffers;

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
    <details open className="group rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <summary className="flex cursor-pointer list-none items-center justify-between p-4 [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold">Listings & bids</h2>
        <span className="text-xs text-neutral-500">
          {offerCount !== undefined
            ? `${offerCount} bid${offerCount === 1 ? "" : "s"} across ${itemsWithOffers ?? 0} item${itemsWithOffers === 1 ? "" : "s"}`
            : pull?.totalEntries !== undefined
              ? `${items.length} / ${pull.totalEntries}`
              : "GetMyeBaySelling + GetBestOffers"}
        </span>
      </summary>
      <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
        {subs?.applicationEnabled === false && (
          <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            Webhook delivery is OFF — run{" "}
            <code className="font-mono">node scripts/setup-notifications.mjs</code> to subscribe.
          </div>
        )}

        {/* Action bar — Pull latest bids is primary, Pull active items secondary */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-neutral-500">
            Pull bids first to see what&apos;s pending. Active items load automatically
            ({PAGE_SIZE} per page) — items with recent activity float to the top.
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
            <button
              type="button"
              onClick={pullBids}
              disabled={offersLoading}
              className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
            >
              {offersLoading ? "Pulling bids…" : "Pull latest bids"}
            </button>
            <button
              type="button"
              onClick={() => pullFirst()}
              disabled={pullLoading}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {pullLoading && items.length === 0 ? "Pulling…" : "Pull active items"}
            </button>
            <button
              type="button"
              onClick={clearView}
              disabled={pullLoading || (items.length === 0 && pull === null && !offersCall.data)}
              title="Clears the on-screen tables only — does not touch eBay."
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Clear view
            </button>
          </div>
        </div>

        {offersError && <p className="mb-2 text-xs text-red-600">{offersError}</p>}

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
                    Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(currentPage * PAGE_SIZE, sortedItems.length)} of {sortedItems.length}
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
                    {/* Desktop / tablet: data table */}
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase text-neutral-500">
                          <tr>
                            <th className="px-2 py-1"></th>
                            <SortHeader col="itemId" label="ItemID" />
                            <SortHeader col="title" label="Title" />
                            <SortHeader col="sku" label="SKU" />
                            <SortHeader col="quantity" label="Qty" />
                            <SortHeader col="quantitySold" label="Sold" />
                            <SortHeader col="price" label="Price" />
                            <th className="px-2 py-1">Bids</th>
                            <SortHeader col="listingStatus" label="Status" />
                            <SortHeader col="primaryCategoryName" label="Category" />
                            <SortHeader col="listingType" label="Type" />
                          </tr>
                        </thead>
                        <tbody>
                          {displayedItems.map((it) => {
                            const isSelected = rememberedItemId === it.itemId;
                            const bids = offersByItemId.get(it.itemId);
                            const ev = latestEventByItemId.get(it.itemId);
                            const evs = eventsByItemId.get(it.itemId);
                            return (
                              <Fragment key={it.itemId}>
                              <tr
                                className={`border-t border-neutral-100 dark:border-neutral-800 ${
                                  isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                                }`}
                              >
                                <td className="px-2 py-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRememberedItemId(isSelected ? null : it.itemId)
                                    }
                                    title={
                                      isSelected
                                        ? "Currently selected — click to unset"
                                        : "Use this ItemID in the call panels / counter-bid engine"
                                    }
                                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                                      isSelected
                                        ? "bg-blue-600 text-white"
                                        : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                    }`}
                                  >
                                    {isSelected ? "Selected" : "Use"}
                                  </button>
                                </td>
                                <td className="px-2 py-1 font-mono text-xs">
                                  {it.viewItemUrl ? (
                                    <a
                                      href={it.viewItemUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-blue-600 hover:underline"
                                    >
                                      {it.itemId}
                                    </a>
                                  ) : (
                                    it.itemId
                                  )}
                                </td>
                                <td className="px-2 py-1">
                                  <div>{it.title}</div>
                                  {ev && (
                                    <div className="mt-0.5 text-[11px]">
                                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                        🔔 {ev.eventName}
                                      </span>
                                      <span className="ml-1 text-neutral-500">
                                        {formatTimeAgo(ev.timestamp)}
                                        {ev.offerPrice !== undefined &&
                                          ` · ${ev.offerPrice} ${ev.currency || ""}`}
                                        {ev.buyerUserId && ` · ${ev.buyerUserId}`}
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-1 font-mono text-xs">{it.sku}</td>
                                <td className="px-2 py-1">{it.quantity}</td>
                                <td className="px-2 py-1">{it.quantitySold}</td>
                                <td className="px-2 py-1">
                                  {it.price} {it.currency}
                                </td>
                                <td className="px-2 py-1 text-xs">
                                  {bids && bids.length > 0 ? (
                                    <ul className="space-y-0.5">
                                      {bids.map((b) => (
                                        <li key={b.bestOfferId}>
                                          <span className="font-medium">
                                            {b.offerPrice} {b.currency}
                                          </span>{" "}
                                          <span className="text-neutral-500">
                                            × {b.quantity} · {b.buyerUserId || "—"} ·{" "}
                                            {formatExpiration(b.expirationTime)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-neutral-400">—</span>
                                  )}
                                </td>
                                <td className="px-2 py-1 text-xs">
                                  {bids || ev ? (
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
                                <td className="px-2 py-1 text-xs text-neutral-500">
                                  {it.primaryCategoryName || it.primaryCategoryId}
                                </td>
                                <td className="px-2 py-1">{it.listingType}</td>
                              </tr>
                              {evs && evs.length > 0 && (
                                <tr
                                  className={`border-t border-neutral-100 dark:border-neutral-800 ${
                                    isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                                  }`}
                                >
                                  <td colSpan={11} className="px-2 pb-2 pt-0">
                                    <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] dark:border-amber-900/40 dark:bg-amber-950/20">
                                      <ul className="space-y-0.5">
                                        {evs.map((e) => (
                                          <li
                                            key={e.id}
                                            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                                          >
                                            <span className="font-mono text-neutral-500">
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
                        const bids = offersByItemId.get(it.itemId);
                        const ev = latestEventByItemId.get(it.itemId);
                        const evs = eventsByItemId.get(it.itemId);
                        return (
                          <li
                            key={it.itemId}
                            className={`rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800 ${
                              isSelected ? "bg-blue-50 dark:bg-blue-950/30" : ""
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              {it.pictureUrls?.[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={it.pictureUrls[0]}
                                  alt=""
                                  loading="lazy"
                                  className="w-28 flex-shrink-0 rounded object-contain"
                                />
                              ) : (
                                <div className="aspect-square w-28 flex-shrink-0 rounded bg-neutral-100 dark:bg-neutral-800" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="mb-2 flex items-start justify-between gap-2">
                                  <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                                    {it.title}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRememberedItemId(isSelected ? null : it.itemId)
                                    }
                                    className={`flex-shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
                                      isSelected
                                        ? "bg-blue-600 text-white"
                                        : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                    }`}
                                  >
                                    {isSelected ? "Selected" : "Use"}
                                  </button>
                                </div>
                                {evs && evs.length > 0 && (
                                  <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] dark:border-amber-900/40 dark:bg-amber-950/20">
                                    <ul className="space-y-0.5">
                                      {evs.map((e) => (
                                        <li
                                          key={e.id}
                                          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                                        >
                                          <span className="font-mono text-neutral-500">
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
                                  <dt className="text-neutral-500">ItemID</dt>
                                  <dd className="font-mono">
                                    {it.viewItemUrl ? (
                                      <a
                                        href={it.viewItemUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-blue-600 hover:underline"
                                      >
                                        {it.itemId}
                                      </a>
                                    ) : (
                                      it.itemId
                                    )}
                                  </dd>
                                  {it.sku && (
                                    <>
                                      <dt className="text-neutral-500">SKU</dt>
                                      <dd className="font-mono">{it.sku}</dd>
                                    </>
                                  )}
                                  <dt className="text-neutral-500">Qty / Sold</dt>
                                  <dd>
                                    {it.quantity} / {it.quantitySold}
                                  </dd>
                                  <dt className="text-neutral-500">Price</dt>
                                  <dd>
                                    {it.price} {it.currency}
                                  </dd>
                                  <dt className="text-neutral-500">Status</dt>
                                  <dd>
                                    {bids || ev ? (
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
                                  {(it.primaryCategoryName || it.primaryCategoryId) && (
                                    <>
                                      <dt className="text-neutral-500">Category</dt>
                                      <dd className="text-neutral-500">
                                        {it.primaryCategoryName || it.primaryCategoryId}
                                      </dd>
                                    </>
                                  )}
                                  <dt className="text-neutral-500">Type</dt>
                                  <dd>{it.listingType}</dd>
                                  {bids && bids.length > 0 && (
                                    <>
                                      <dt className="text-neutral-500">Bids</dt>
                                      <dd>
                                        <ul className="space-y-0.5">
                                          {bids.map((b) => (
                                            <li key={b.bestOfferId}>
                                              <span className="font-medium">
                                                {b.offerPrice} {b.currency}
                                              </span>{" "}
                                              × {b.quantity} ·{" "}
                                              <span className="font-mono">
                                                {b.buyerUserId || "—"}
                                              </span>{" "}
                                              ·{" "}
                                              <span className="text-neutral-500">
                                                {formatExpiration(b.expirationTime)}
                                              </span>
                                            </li>
                                          ))}
                                        </ul>
                                      </dd>
                                    </>
                                  )}
                                </dl>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="mt-3 flex items-center justify-center gap-2">
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
                          <span className="ml-2 text-neutral-400">
                            (loading {sortedItems.length}/{pull?.totalEntries ?? "?"}…)
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
  );
}

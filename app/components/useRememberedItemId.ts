"use client";

import { useCallback, useEffect, useState } from "react";

export const REMEMBERED_ITEM_STORAGE_KEY = "ebay-passthru:lastItemId";
const EVENT_NAME = "ebay-passthru:item-id-changed";

// Shared state between CallPanel (consumer) and FeedView (producer):
// the last ItemID the user has "selected" for use in GetItem / ReviseItem / EndItem.
// Uses localStorage for persistence and a window CustomEvent for same-window sync.
export function useRememberedItemId() {
  const [itemId, setItemIdState] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(REMEMBERED_ITEM_STORAGE_KEY);
    if (saved) setItemIdState(saved);

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string | null>).detail;
      setItemIdState(detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const setItemId = useCallback((next: string | null) => {
    if (typeof window === "undefined") return;
    if (next) window.localStorage.setItem(REMEMBERED_ITEM_STORAGE_KEY, next);
    else window.localStorage.removeItem(REMEMBERED_ITEM_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent<string | null>(EVENT_NAME, { detail: next }));
  }, []);

  return [itemId, setItemId] as const;
}

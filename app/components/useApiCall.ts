"use client";

import { useCallback, useState } from "react";

export interface UseApiCall<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  // POSTs `body` as JSON to `url` and parses the response as T. Returns the
  // parsed data, or null on network/parse failure (error message is in `error`).
  // Pass `silent: true` to keep stale data visible during a background refresh.
  run: (url: string, body?: unknown, opts?: { silent?: boolean }) => Promise<T | null>;
  reset: () => void;
  setData: (next: T | null) => void;
  setError: (msg: string | null) => void;
}

export function useApiCall<T>(): UseApiCall<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (
    url: string,
    body?: unknown,
    opts?: { silent?: boolean },
  ): Promise<T | null> => {
    setLoading(true);
    if (!opts?.silent) {
      setData(null);
      setError(null);
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = (await res.json()) as T;
      setData(json);
      return json;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { data, error, loading, run, reset, setData, setError };
}

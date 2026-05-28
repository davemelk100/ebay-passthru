import "server-only";

import type { NotificationEvent } from "./types";

interface NotificationStore {
  push(event: NotificationEvent): Promise<void>;
  recent(limit?: number): Promise<NotificationEvent[]>;
  count(): Promise<number>;
}

// ----- In-memory fallback -------------------------------------------------
// Survives across requests within a warm Vercel Function instance but loses
// events on cold start. Fine for demo / single-instance prod traffic; set
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to upgrade to durable.

const MAX_IN_MEMORY = 500;
const buffer: NotificationEvent[] = [];

const memoryStore: NotificationStore = {
  async push(event) {
    buffer.unshift(event);
    if (buffer.length > MAX_IN_MEMORY) buffer.length = MAX_IN_MEMORY;
  },
  async recent(limit = 100) {
    return buffer.slice(0, limit);
  },
  async count() {
    return buffer.length;
  },
};

// ----- Upstash Redis -----------------------------------------------------

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const KEY = "ebay:notifications:recent";

async function upstash(commands: (string | number)[][]): Promise<unknown[]> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error("Upstash env not set");
  const r = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`Upstash HTTP ${r.status}: ${await r.text()}`);
  const out = (await r.json()) as { result: unknown; error?: string }[];
  for (const item of out) {
    if (item.error) throw new Error(`Upstash command error: ${item.error}`);
  }
  return out.map((i) => i.result);
}

const upstashStore: NotificationStore = {
  async push(event) {
    // Push to head, trim to last 500. LPUSH + LTRIM in one pipeline.
    await upstash([
      ["LPUSH", KEY, JSON.stringify(event)],
      ["LTRIM", KEY, "0", String(MAX_IN_MEMORY - 1)],
    ]);
  },
  async recent(limit = 100) {
    const [raw] = (await upstash([["LRANGE", KEY, "0", String(limit - 1)]])) as [string[]];
    return raw.map((s) => JSON.parse(s) as NotificationEvent);
  },
  async count() {
    const [n] = (await upstash([["LLEN", KEY]])) as [number];
    return n;
  },
};

export const notificationStore: NotificationStore =
  UPSTASH_URL && UPSTASH_TOKEN ? upstashStore : memoryStore;

export const notificationStoreBackend = UPSTASH_URL && UPSTASH_TOKEN ? "upstash" : "memory";

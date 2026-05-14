// Small helpers for walking the JSON shape that fast-xml-parser produces
// from eBay Trading API responses. No Node-only deps so this file is safe
// to import from anywhere (though in practice only routes use it).

// fast-xml-parser collapses single-element arrays into a single object. This
// restores the array shape: undefined/null -> [], single object -> [single],
// array -> array.
export function asArray<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

// Walks a path of string keys through a parsed XML object. Returns the leaf
// value, or undefined if any segment is missing or non-object.
export function getPath(parsed: unknown, path: readonly string[]): unknown {
  let cur: unknown = parsed;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

// Convenience for the most common pattern: drill from the parsed root into
// `<CallName>Response[...path]` and return the value as an array.
export function extractArray<T>(
  parsed: unknown,
  responseName: string,
  ...path: string[]
): T[] {
  return asArray<T>(getPath(parsed, [responseName, ...path]));
}

// Returns parsed?.[responseName] as Record<string, unknown> | undefined so
// callers can pluck additional sibling fields (PaginationResult, Ack, etc.).
export function getResponse(
  parsed: unknown,
  responseName: string,
): Record<string, unknown> | undefined {
  const v = getPath(parsed, [responseName]);
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

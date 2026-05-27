// Wire-level types shared between API routes (server) and React components (client).
// Keep this file free of server-only imports so it can be consumed from both sides.

export interface EbayErrorSummary {
  code?: string;
  shortMessage?: string;
  longMessage?: string;
  severity?: string;
}

// ---------- Inventory ----------

export interface InventoryItem {
  itemId: string;
  title: string;
  sku: string;
  quantity: number;
  quantitySold: number;
  price: string;
  currency: string;
  listingType: string;
  listingStatus: string;
  timeLeft: string;
  viewItemUrl: string;
  startTime: string;
  endTime: string;
  primaryCategoryId: string;
  primaryCategoryName: string;
  pictureUrls: string[];
}

export interface InventoryResult {
  ok: boolean;
  fetched: number;
  totalEntries?: number;
  pageNumber: number;
  totalPages?: number;
  hasMore?: boolean;
  durationMs: number;
  items?: InventoryItem[];
  includeEnded?: boolean;
  window?: { endTimeFrom: string; endTimeTo: string; daysAhead: number; daysBack: number };
  errors?: EbayErrorSummary[];
  error?: string;
  missing?: string[];
}

export interface ClearItemResult {
  itemId: string;
  ended: boolean;
  ack?: string;
  errors: EbayErrorSummary[];
}

export interface ClearResult {
  ok: boolean;
  foundCount?: number;
  endedCount?: number;
  failedCount?: number;
  durationMs?: number;
  results?: ClearItemResult[];
  env?: string;
  error?: string;
  missing?: string[];
  hint?: string;
}

// ---------- Counter-bid ----------

// OfferContext lives here (rather than in counter-bid.ts) so the UI can import
// it without pulling in the server-only rule engine.
export interface OfferContext {
  itemId: string;
  bestOfferId: string;
  buyerUserId?: string;
  offerPrice: number;
  listingPrice: number;
  quantity: number;
  comps?: number[];
  grade?: {
    company?: string;
    score?: number;
    raw?: string;
  };
}

// Flat, UI-friendly view of a Decision. The server emits the discriminated
// `Decision` union from lib/counter-bid.ts; serialized over the wire it
// matches this shape with the variant's fields populated.
export interface DecisionView {
  action: "accept" | "decline" | "counter" | "no-match";
  matchedRule?: string;
  message?: string;
  counterPrice?: number;
  counterQuantity?: number;
  reason?: string;
  priceSource?: { stat?: string; usedFallback?: boolean; value: number };
}

export interface PreviewRow extends OfferContext {
  decision: DecisionView;
}

export interface PreviewResponse {
  ok?: boolean;
  error?: string;
  mode?: string;
  itemId?: string;
  title?: string;
  listingPrice?: number;
  offerCount?: number;
  ruleCount?: number;
  rulesPath?: string;
  compsCount?: number;
  results?: PreviewRow[];
}

export interface ApplyDecisionResult {
  itemId: string;
  bestOfferId: string;
  action: string;
  ok: boolean;
  ack?: string;
  errors: EbayErrorSummary[];
}

export interface ApplyResponse {
  ok?: boolean;
  appliedCount?: number;
  failedCount?: number;
  durationMs?: number;
  env?: string;
  error?: string;
  hint?: string;
  results?: ApplyDecisionResult[];
}

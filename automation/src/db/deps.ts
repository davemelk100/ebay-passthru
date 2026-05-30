// Factory that wires the four DB-backed PipelineDeps + the real eBay client
// for production runtime. Tests do NOT use this — they stub PipelineDeps
// directly via vi.fn() in tests/pipeline.test.ts, so the rule engine + audit
// flow can be exercised without Postgres or sandbox credentials.

import type { EbayConfig } from "../domain/ebay/config.js";
import { respondToBestOffer } from "../domain/ebay/respond.js";
import type { PipelineDeps } from "../domain/pipeline.js";
import type { Db } from "./client.js";
import {
  findExistingDecision,
  insertDecision,
  loadActiveRuleSet,
  resolvePause,
} from "./queries.js";

export function buildPipelineDeps(db: Db, cfg: EbayConfig): PipelineDeps {
  return {
    findExistingDecision: (id) => findExistingDecision(db, id),
    loadActiveRuleSet: () => loadActiveRuleSet(db),
    resolvePause: (itemId) => resolvePause(db, itemId),
    insertDecision: (row) => insertDecision(db, row),
    respondToBestOffer: (input) => respondToBestOffer(input, cfg),
  };
}

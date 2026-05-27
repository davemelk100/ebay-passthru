// Sample inner-XML bodies for common Trading API calls.
// Kept in its own module so client components can import it without pulling in server-only code.

// Trading calls that mutate live data — server hard-blocks these in production.
// The UI also disables their pills. Mirrored here so the client can render the
// visual state without importing server-only modules.
export const DESTRUCTIVE_CALLS = new Set<string>([
  "AddItem",
  "AddItems",
  "AddFixedPriceItem",
  "ReviseItem",
  "ReviseItems",
  "ReviseFixedPriceItem",
  "RelistItem",
  "RelistFixedPriceItem",
  "EndItem",
  "EndItems",
  "EndFixedPriceItem",
  "RespondToBestOffer",
]);

// Allowlist of Trading calls accepted by /api/ebay in production. Anything not
// in this set is rejected, so adding a call like LeaveFeedback, IssueRefund,
// AddMemberMessage*, ReviseInventoryStatus, etc. cannot be invoked via the
// public route. Sandbox still accepts any callName.
export const PRODUCTION_ALLOWED_CALLS = new Set<string>([
  "GetUser",
  "GetItem",
  "GetSellerList",
  "GetMyeBaySelling",
]);

// Path prefixes for /api/sell rejected in production. These leak buyer PII
// (orders include name + shipping address + payment summary), financial data,
// or your seller identity. GET on these is blocked too, not just writes.
export const PRODUCTION_BLOCKED_SELL_PREFIXES: readonly string[] = [
  "/sell/fulfillment/",
  "/sell/finances/",
  "/commerce/identity/",
];

export const SAMPLE_BODIES: Record<string, string> = {
  GetUser: "",
  GetMyeBaySelling: `<ActiveList>
  <Include>true</Include>
  <Pagination>
    <EntriesPerPage>25</EntriesPerPage>
    <PageNumber>1</PageNumber>
  </Pagination>
</ActiveList>`,
  GetSellerList: `<StartTimeFrom>2026-04-12T00:00:00.000Z</StartTimeFrom>
<StartTimeTo>2026-05-12T23:59:59.000Z</StartTimeTo>
<DetailLevel>ReturnAll</DetailLevel>
<GranularityLevel>Fine</GranularityLevel>
<IncludeWatchCount>true</IncludeWatchCount>
<Pagination>
  <EntriesPerPage>25</EntriesPerPage>
  <PageNumber>1</PageNumber>
</Pagination>`,
  GetItem: `<ItemID>REPLACE_WITH_ITEM_ID</ItemID>
<DetailLevel>ReturnAll</DetailLevel>
<IncludeItemSpecifics>true</IncludeItemSpecifics>`,
};

// Sample inner-XML bodies for common Trading API calls.
// Kept in its own module so client components can import it without pulling in server-only code.

// Trading calls that mutate live data — blocked in production unless `allowProduction: true`
// is passed in the request body. Mirror this set on the server and the client so the UI can
// warn before sending.
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
]);

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
  AddItem: `<Item>
  <Title>[SANDBOX] Passthru test listing — please ignore</Title>
  <Description>Sandbox automation test listing. Not a real product.</Description>
  <PrimaryCategory><CategoryID>9355</CategoryID></PrimaryCategory>
  <StartPrice currencyID="USD">9.99</StartPrice>
  <ConditionID>1000</ConditionID>
  <Country>US</Country>
  <Currency>USD</Currency>
  <DispatchTimeMax>3</DispatchTimeMax>
  <ListingDuration>GTC</ListingDuration>
  <ListingType>FixedPriceItem</ListingType>
  <PictureDetails><PictureURL>https://picsum.photos/600/400</PictureURL></PictureDetails>
  <PostalCode>95125</PostalCode>
  <Quantity>1</Quantity>
  <ItemSpecifics>
    <NameValueList><Name>Brand</Name><Value>Unbranded</Value></NameValueList>
    <NameValueList><Name>Model</Name><Value>Test Model</Value></NameValueList>
    <NameValueList><Name>Color</Name><Value>Black</Value></NameValueList>
    <NameValueList><Name>Storage Capacity</Name><Value>64 GB</Value></NameValueList>
  </ItemSpecifics>
  <ReturnPolicy>
    <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
    <RefundOption>MoneyBack</RefundOption>
    <ReturnsWithinOption>Days_30</ReturnsWithinOption>
    <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
  </ReturnPolicy>
  <ShippingDetails>
    <ShippingType>Flat</ShippingType>
    <ShippingServiceOptions>
      <ShippingServicePriority>1</ShippingServicePriority>
      <ShippingService>USPSPriority</ShippingService>
      <ShippingServiceCost currencyID="USD">5.00</ShippingServiceCost>
    </ShippingServiceOptions>
  </ShippingDetails>
  <Site>US</Site>
</Item>`,
  ReviseItem: `<Item>
  <ItemID>REPLACE_WITH_ITEM_ID</ItemID>
  <Title>Passthru test listing (revised)</Title>
</Item>`,
  EndItem: `<ItemID>REPLACE_WITH_ITEM_ID</ItemID>
<EndingReason>NotAvailable</EndingReason>`,
};

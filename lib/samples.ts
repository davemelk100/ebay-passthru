// Sample inner-XML bodies for common Trading API calls.
// Kept in its own module so client components can import it without pulling in server-only code.
export const SAMPLE_BODIES: Record<string, string> = {
  GeteBayOfficialTime: "",
  GetUser: "",
  GetMyeBaySelling: `<ActiveList>
  <Include>true</Include>
  <Pagination>
    <EntriesPerPage>25</EntriesPerPage>
    <PageNumber>1</PageNumber>
  </Pagination>
</ActiveList>`,
  GetItem: `<ItemID>REPLACE_WITH_ITEM_ID</ItemID>
<DetailLevel>ReturnAll</DetailLevel>`,
  AddItem: `<Item>
  <Title>Passthru test listing — DO NOT BUY</Title>
  <Description>Automated CRUD verification listing. Will be ended shortly.</Description>
  <PrimaryCategory><CategoryID>9355</CategoryID></PrimaryCategory>
  <StartPrice currencyID="USD">9.99</StartPrice>
  <ConditionID>1000</ConditionID>
  <Country>US</Country>
  <Currency>USD</Currency>
  <DispatchTimeMax>3</DispatchTimeMax>
  <ListingDuration>Days_7</ListingDuration>
  <ListingType>FixedPriceItem</ListingType>
  <PaymentMethods>PayPal</PaymentMethods>
  <PayPalEmailAddress>test@example.com</PayPalEmailAddress>
  <PictureDetails><PictureURL>https://i.ebayimg.com/images/g/sample/s-l1600.jpg</PictureURL></PictureDetails>
  <PostalCode>95125</PostalCode>
  <Quantity>1</Quantity>
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

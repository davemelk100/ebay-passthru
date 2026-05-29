// Re-export surface for the eBay Trading API client. Routes should import
// from "@/domain/ebay" (or relative equivalent) and not reach into individual
// files — keeps the module boundary clean if/when we swap implementations.

export {
  type EbayConfig,
  type EbayEnv,
  configFromEnv,
  configIssues,
  endpointFor,
  identityEndpoint,
} from "./config.js";

export {
  type EbayCallResult,
  type EbayError,
  buildRequestBody,
  callTradingApi,
  extractErrors,
  getAccessToken,
} from "./trading.js";

export { asArray, extractArray, getPath, getResponse, parser } from "./xml.js";

export {
  type NotificationCreds,
  type ParsedNotification,
  type ParseResult,
  parseNotificationXml,
  verifyNotificationSignature,
} from "./notifications.js";

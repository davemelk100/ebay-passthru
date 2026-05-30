import { describe, expect, it } from "vitest";
import { configIssues, endpointFor, identityEndpoint } from "../../src/domain/ebay/config.js";
import type { EbayConfig } from "../../src/domain/ebay/config.js";

function baseConfig(overrides: Partial<EbayConfig> = {}): EbayConfig {
  return {
    env: "sandbox",
    appId: "app",
    devId: "dev",
    certId: "cert",
    authToken: "auth",
    refreshToken: "",
    siteId: "0",
    compatLevel: "1193",
    ...overrides,
  };
}

describe("configIssues", () => {
  it("returns no issues for a fully-populated config", () => {
    expect(configIssues(baseConfig())).toEqual([]);
  });
  it("flags missing app/dev/cert IDs", () => {
    expect(configIssues(baseConfig({ appId: "", devId: "", certId: "" }))).toEqual([
      "EBAY_APP_ID",
      "EBAY_DEV_ID",
      "EBAY_CERT_ID",
    ]);
  });
  it("requires either authToken or refreshToken", () => {
    expect(configIssues(baseConfig({ authToken: "", refreshToken: "" }))).toEqual([
      "EBAY_AUTH_TOKEN or EBAY_REFRESH_TOKEN",
    ]);
    expect(configIssues(baseConfig({ authToken: "", refreshToken: "rt" }))).toEqual([]);
  });
});

describe("endpointFor", () => {
  it("returns the sandbox URL for sandbox", () => {
    expect(endpointFor("sandbox")).toBe("https://api.sandbox.ebay.com/ws/api.dll");
  });
  it("returns the production URL for production", () => {
    expect(endpointFor("production")).toBe("https://api.ebay.com/ws/api.dll");
  });
});

describe("identityEndpoint", () => {
  it("returns the sandbox OAuth URL for sandbox", () => {
    expect(identityEndpoint("sandbox")).toBe(
      "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    );
  });
  it("returns the production OAuth URL for production", () => {
    expect(identityEndpoint("production")).toBe("https://api.ebay.com/identity/v1/oauth2/token");
  });
});

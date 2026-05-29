import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EbayConfig } from "../../src/domain/ebay/config.js";

// Mock curl so we exercise the full callTradingApi flow without shelling out
// to the system curl binary or hitting the eBay sandbox in tests.
vi.mock("../../src/domain/ebay/curl.js", () => ({
  curlRequest: vi.fn(),
}));

import { curlRequest } from "../../src/domain/ebay/curl.js";
import {
  _resetAccessTokenCacheForTests,
  buildRequestBody,
  callTradingApi,
  extractErrors,
  getAccessToken,
} from "../../src/domain/ebay/trading.js";

const curlMock = vi.mocked(curlRequest);

function cfg(overrides: Partial<EbayConfig> = {}): EbayConfig {
  return {
    env: "sandbox",
    appId: "app",
    devId: "dev",
    certId: "cert",
    authToken: "static-auth",
    refreshToken: "",
    siteId: "0",
    compatLevel: "1193",
    ...overrides,
  };
}

describe("buildRequestBody", () => {
  it("wraps bare inner XML in the standard envelope", () => {
    const out = buildRequestBody("GetUser", "<DetailLevel>ReturnAll</DetailLevel>");
    expect(out).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(out).toContain("<GetUserRequest");
    expect(out).toContain("<DetailLevel>ReturnAll</DetailLevel>");
    expect(out).toContain("</GetUserRequest>");
  });

  it("passes through pre-enveloped XML unchanged after prepending the XML declaration", () => {
    const inner = `<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents"><X>1</X></GetUserRequest>`;
    const out = buildRequestBody("GetUser", inner);
    expect(out).toBe(`<?xml version="1.0" encoding="utf-8"?>\n${inner}`);
  });
});

describe("extractErrors", () => {
  it("returns [] for missing/empty Errors", () => {
    expect(extractErrors(undefined)).toEqual([]);
    expect(extractErrors({})).toEqual([]);
  });
  it("maps a single Errors element into a one-item array", () => {
    expect(
      extractErrors({
        Errors: {
          ErrorCode: 123,
          ShortMessage: "Oops",
          LongMessage: "Something went wrong.",
          SeverityCode: "Error",
        },
      }),
    ).toEqual([
      { code: "123", shortMessage: "Oops", longMessage: "Something went wrong.", severity: "Error" },
    ]);
  });
  it("maps an Errors array into N items", () => {
    const out = extractErrors({ Errors: [{ ErrorCode: 1 }, { ErrorCode: 2 }] });
    expect(out.map((e) => e.code)).toEqual(["1", "2"]);
  });
});

describe("getAccessToken", () => {
  beforeEach(() => {
    _resetAccessTokenCacheForTests();
    curlMock.mockReset();
  });

  it("returns the static authToken when refreshToken is unset", async () => {
    const token = await getAccessToken(cfg({ authToken: "static-auth", refreshToken: "" }));
    expect(token).toBe("static-auth");
    expect(curlMock).not.toHaveBeenCalled();
  });

  it("throws when neither authToken nor refreshToken is set", async () => {
    await expect(getAccessToken(cfg({ authToken: "", refreshToken: "" }))).rejects.toThrowError(
      /No EBAY_AUTH_TOKEN or EBAY_REFRESH_TOKEN/,
    );
  });

  it("hits the identity endpoint to mint a fresh token from refreshToken", async () => {
    curlMock.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ access_token: "minted-1", expires_in: 7200 }),
    });
    const token = await getAccessToken(cfg({ authToken: "", refreshToken: "rt" }));
    expect(token).toBe("minted-1");
    expect(curlMock).toHaveBeenCalledTimes(1);
    const [url, method, headers, body] = curlMock.mock.calls[0]!;
    expect(url).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect(method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.Authorization).toMatch(/^Basic /);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=rt");
  });

  it("reuses the cached token until it expires", async () => {
    curlMock.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ access_token: "minted-2", expires_in: 7200 }),
    });
    const c = cfg({ authToken: "", refreshToken: "rt" });
    const a = await getAccessToken(c);
    const b = await getAccessToken(c);
    expect(a).toBe(b);
    expect(curlMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces non-200 identity responses as Error", async () => {
    curlMock.mockResolvedValueOnce({ status: 401, text: '{"error":"invalid_grant"}' });
    await expect(
      getAccessToken(cfg({ authToken: "", refreshToken: "bad-rt" })),
    ).rejects.toThrowError(/HTTP 401/);
  });

  it("dedupes parallel refreshes into a single inflight call", async () => {
    let resolveOnce: ((value: { status: number; text: string }) => void) | null = null;
    curlMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOnce = resolve;
      }),
    );
    const c = cfg({ authToken: "", refreshToken: "rt" });
    const p1 = getAccessToken(c);
    const p2 = getAccessToken(c);
    expect(curlMock).toHaveBeenCalledTimes(1);
    resolveOnce!({
      status: 200,
      text: JSON.stringify({ access_token: "minted-3", expires_in: 7200 }),
    });
    await expect(p1).resolves.toBe("minted-3");
    await expect(p2).resolves.toBe("minted-3");
  });
});

describe("callTradingApi", () => {
  beforeEach(() => {
    _resetAccessTokenCacheForTests();
    curlMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the wrapped envelope with all required Trading API headers", async () => {
    curlMock.mockResolvedValueOnce({
      status: 200,
      text:
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">' +
        "<Ack>Success</Ack></GetUserResponse>",
    });
    const result = await callTradingApi("GetUser", "", cfg());
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.ack).toBe("Success");
    expect(result.errors).toEqual([]);
    expect(result.endpoint).toBe("https://api.sandbox.ebay.com/ws/api.dll");

    expect(curlMock).toHaveBeenCalledTimes(1);
    const [url, method, headers, body] = curlMock.mock.calls[0]!;
    expect(url).toBe("https://api.sandbox.ebay.com/ws/api.dll");
    expect(method).toBe("POST");
    expect(headers["Content-Type"]).toBe("text/xml");
    expect(headers["X-EBAY-API-CALL-NAME"]).toBe("GetUser");
    expect(headers["X-EBAY-API-IAF-TOKEN"]).toBe("static-auth");
    expect(headers["X-EBAY-API-COMPATIBILITY-LEVEL"]).toBe("1193");
    expect(headers["X-EBAY-API-DEV-NAME"]).toBe("dev");
    expect(headers["X-EBAY-API-APP-NAME"]).toBe("app");
    expect(headers["X-EBAY-API-CERT-NAME"]).toBe("cert");
    expect(headers["X-EBAY-API-SITEID"]).toBe("0");
    expect(body).toContain("<GetUserRequest");
  });

  it("flags ok=false when the API returns an Error ack", async () => {
    curlMock.mockResolvedValueOnce({
      status: 200,
      text:
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">' +
        "<Ack>Failure</Ack>" +
        "<Errors><ErrorCode>1.0</ErrorCode><ShortMessage>nope</ShortMessage>" +
        "<SeverityCode>Error</SeverityCode></Errors>" +
        "</GetUserResponse>",
    });
    const r = await callTradingApi("GetUser", "", cfg());
    expect(r.ok).toBe(false);
    expect(r.ack).toBe("Failure");
    expect(r.errors).toEqual([
      { code: "1", shortMessage: "nope", severity: "Error", longMessage: undefined },
    ]);
  });

  it("returns parsed=null on malformed XML but still propagates the status", async () => {
    curlMock.mockResolvedValueOnce({ status: 500, text: "<bad><<not xml" });
    const r = await callTradingApi("GetUser", "", cfg());
    expect(r.status).toBe(500);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([]);
  });
});

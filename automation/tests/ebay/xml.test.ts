import { describe, expect, it } from "vitest";
import { asArray, extractArray, getPath, getResponse } from "../../src/domain/ebay/xml.js";

describe("asArray", () => {
  it("wraps a bare object in an array", () => {
    expect(asArray({ a: 1 })).toEqual([{ a: 1 }]);
  });
  it("passes arrays through", () => {
    expect(asArray([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });
  it("returns [] for null and undefined", () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
  });
});

describe("getPath", () => {
  const tree = { A: { B: { C: 42 } }, X: null };
  it("walks valid paths", () => {
    expect(getPath(tree, ["A", "B", "C"])).toBe(42);
  });
  it("returns undefined on missing keys", () => {
    expect(getPath(tree, ["A", "Q"])).toBeUndefined();
    expect(getPath(tree, ["Z"])).toBeUndefined();
  });
  it("returns undefined when traversal hits a non-object", () => {
    expect(getPath(tree, ["X", "Y"])).toBeUndefined();
    expect(getPath(42, ["a"])).toBeUndefined();
  });
});

describe("extractArray", () => {
  it("extracts a single nested object as an array", () => {
    const parsed = { GetItemResponse: { Item: { ItemID: "1" } } };
    expect(extractArray(parsed, "GetItemResponse", "Item")).toEqual([{ ItemID: "1" }]);
  });
  it("passes through a real array", () => {
    const parsed = {
      GetSellerListResponse: {
        ItemArray: { Item: [{ ItemID: "1" }, { ItemID: "2" }] },
      },
    };
    expect(extractArray(parsed, "GetSellerListResponse", "ItemArray", "Item")).toHaveLength(2);
  });
  it("returns [] when the path doesn't resolve", () => {
    expect(extractArray({}, "GetItemResponse", "Item")).toEqual([]);
  });
});

describe("getResponse", () => {
  it("returns the response root as a record", () => {
    const parsed = { GetUserResponse: { Ack: "Success", User: {} } };
    const r = getResponse(parsed, "GetUserResponse");
    expect(r?.Ack).toBe("Success");
  });
  it("returns undefined when the response is missing", () => {
    expect(getResponse({}, "GetUserResponse")).toBeUndefined();
  });
});

// #897 — BytePlus free-tier keys must reach the standard ModelArk surface.
// Coding Plan remains selectable per connection; every default is standard.
import { describe, it, expect } from "vitest";
import byteplus from "../../open-sse/providers/registry/byteplus.js";
import {
  BYTEPLUS_DEFAULT_ENDPOINT_MODE,
  BYTEPLUS_DEFAULT_MODEL,
  BYTEPLUS_ENDPOINTS,
  getByteplusBaseUrl,
  getByteplusChatUrl,
  getByteplusModel,
  isByteplusAuthFailure,
  resolveByteplusEndpointMode,
} from "../../open-sse/config/byteplus.js";

describe("byteplus endpoint mode (standard is the default)", () => {
  it("defaults to standard with no providerSpecificData", () => {
    expect(BYTEPLUS_DEFAULT_ENDPOINT_MODE).toBe("standard");
    expect(resolveByteplusEndpointMode(undefined)).toBe("standard");
    expect(getByteplusBaseUrl()).toBe(BYTEPLUS_ENDPOINTS.standard);
    expect(getByteplusChatUrl()).toBe(`${BYTEPLUS_ENDPOINTS.standard}/chat/completions`);
  });

  it("uses the coding path only when the connection opts in", () => {
    expect(resolveByteplusEndpointMode({ endpointMode: "coding" })).toBe("coding");
    expect(getByteplusBaseUrl({ endpointMode: "coding" })).toBe(BYTEPLUS_ENDPOINTS.coding);
    expect(getByteplusChatUrl({ endpointMode: "coding" })).toBe(`${BYTEPLUS_ENDPOINTS.coding}/chat/completions`);
  });

  it("keeps the explicit standard path", () => {
    expect(getByteplusBaseUrl({ endpointMode: "standard" })).toBe("https://ark.ap-southeast.bytepluses.com/api/v3");
  });

  it("falls back to standard for an unknown mode", () => {
    expect(resolveByteplusEndpointMode({ endpointMode: "bogus" })).toBe("standard");
    expect(getByteplusChatUrl({ endpointMode: "bogus" })).toBe(`${BYTEPLUS_ENDPOINTS.standard}/chat/completions`);
  });

  it("advertises the standard path in the registry", () => {
    expect(byteplus.category).toBe("freeTier");
    expect(byteplus.transport.baseUrl).toBe(`${BYTEPLUS_ENDPOINTS.standard}/chat/completions`);
    expect(byteplus.transport.baseUrl).not.toContain("/api/coding/v3");
  });
});

describe("byteplus model selection", () => {
  it("trims a connection model and keeps the registry default otherwise", () => {
    expect(getByteplusModel({ model: "  kimi-k2-thinking-251104  " })).toBe("kimi-k2-thinking-251104");
    expect(getByteplusModel({ model: "   " }, BYTEPLUS_DEFAULT_MODEL)).toBe(BYTEPLUS_DEFAULT_MODEL);
    expect(getByteplusModel(undefined, BYTEPLUS_DEFAULT_MODEL)).toBe(BYTEPLUS_DEFAULT_MODEL);
  });
});

describe("byteplus error classification", () => {
  it("treats auth-shaped bodies as an invalid key", () => {
    expect(isByteplusAuthFailure('{"error":{"code":"AuthenticationError"}}')).toBe(true);
    expect(isByteplusAuthFailure('{"error":{"message":"InvalidApiKey"}}')).toBe(true);
    expect(isByteplusAuthFailure("invalid api key")).toBe(true);
  });

  it("keeps plan/model errors as valid-key warnings", () => {
    for (const body of [
      '{"error":{"code":"403 AccessDenied"}}',
      '{"error":{"code":"400 InvalidSubscription"}}',
      '{"error":{"code":"404 ModelNotOpen"}}',
    ]) {
      expect(isByteplusAuthFailure(body)).toBe(false);
    }
  });
});

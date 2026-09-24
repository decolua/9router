import { describe, it, expect } from "vitest";
import { buildErrorBody } from "open-sse/utils/error.js";
import { isRoutableProvider } from "@/shared/constants/providers.js";

/**
 * ERROR_TYPES maps one code per status, and for 404 that code is
 * "model_not_found". That is right when the model really is unknown, and wrong
 * for the other 404 the chat handler emits: "no account connected for this
 * provider". A client reading model_not_found there looks for a bad model name,
 * when the fix is a dashboard action only the operator can take.
 */
describe("404 error codes", () => {
  it("still says model_not_found by default, so existing callers are unchanged", () => {
    expect(buildErrorBody(404, "x").error).toMatchObject({
      type: "invalid_request_error",
      code: "model_not_found",
    });
  });

  it("lets a caller that knows better name the real cause", () => {
    expect(buildErrorBody(404, "x", { code: "provider_not_configured" }).error).toMatchObject({
      type: "invalid_request_error",
      code: "provider_not_configured",
    });
  });

  it.each([
    [400, "bad_request"],
    [401, "invalid_api_key"],
    [429, "rate_limit_exceeded"],
    [503, "service_unavailable"],
  ])("leaves %i alone", (status, code) => {
    expect(buildErrorBody(status, "x").error.code).toBe(code);
  });

  it("keeps the table's type when only the code is overridden", () => {
    expect(buildErrorBody(404, "x", { code: "provider_not_configured" }).error.type)
      .toBe("invalid_request_error");
  });

  it("keeps the table's code when only the type is overridden", () => {
    expect(buildErrorBody(404, "x", { type: "server_error" }).error.code).toBe("model_not_found");
  });
});

/**
 * "No account connected" and "no such provider" reach the same line in
 * chat.js but have different fixes, so they need different answers. Telling
 * someone with a typo to go connect an account for a provider that does not
 * exist is a dead end.
 */
describe("isRoutableProvider", () => {
  it.each([
    ["a registry id", "codex"],
    ["another registry id", "claude"],
    ["an alias", "cc"],
    ["a hyphenated id", "gemini-cli"],
  ])("accepts %s", (_label, name) => {
    expect(isRoutableProvider(name)).toBe(true);
  });

  // These carry a prefix and are deliberately absent from the registry, yet they
  // reach account selection by the identical path. A registry-only check would
  // call a user's own node an unknown provider the moment it went inactive.
  it.each([
    ["an openai-compatible node", "openai-compatible-mybox"],
    ["an anthropic-compatible node", "anthropic-compatible-mybox"],
  ])("accepts %s", (_label, name) => {
    expect(isRoutableProvider(name)).toBe(true);
  });

  it.each([
    ["a typo", "nosuchprovider"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
  ])("rejects %s", (_label, name) => {
    expect(isRoutableProvider(name)).toBe(false);
  });

  it("is not fooled by a bare prefix-like name that is not a node", () => {
    expect(isRoutableProvider("openai-compatible")).toBe(false);
  });
});

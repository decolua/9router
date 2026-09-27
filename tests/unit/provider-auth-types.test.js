import { describe, it, expect } from "vitest";
import { providerAuthTypes } from "@/shared/utils/providerAuthTypes";
import PROVIDER_REGISTRY from "open-sse/providers/registry/index.js";
import { FREE_TIER_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/providers";

/**
 * The Providers grid counts a provider's connections by filtering the whole
 * connection list down to the authTypes this returns. The regression it exists
 * for: every `authModes: ["none"]` provider stores its connections with
 * authType "none", and the old logic collapsed anything without an apikey mode
 * to "oauth" alone — so claude-cli reported "No connections" while holding
 * working accounts.
 */
describe("providerAuthTypes", () => {
  it("counts authType none for a provider that declares only that mode", () => {
    expect(providerAuthTypes({ authModes: ["none"] }, "claude-cli")).toContain("none");
  });

  it("counts both oauth and apikey spellings for a dual-auth provider", () => {
    const types = providerAuthTypes({ authModes: ["oauth", "apikey"] }, "anthropic");
    expect(types).toEqual(expect.arrayContaining(["oauth", "apikey", "api_key"]));
  });

  it("does not invent an apikey mode for an oauth-only provider", () => {
    expect(providerAuthTypes({ authModes: ["oauth"] }, "claude")).toEqual(["oauth"]);
  });

  it("keeps kiro's three spellings, which its registry entry does not declare", () => {
    expect(providerAuthTypes({}, "kiro")).toEqual(["oauth", "apikey", "api_key"]);
  });

  it("falls back to apikey for a free-tier provider with no declared modes", () => {
    const types = providerAuthTypes(undefined, "cloudflare-ai", { freeTier: { "cloudflare-ai": {} } });
    expect(types).toEqual(expect.arrayContaining(["apikey", "api_key"]));
  });

  it("stays oauth-only for an undeclared provider in neither table", () => {
    expect(providerAuthTypes(undefined, "mystery", { freeTier: {}, apiKey: {} })).toEqual(["oauth"]);
  });

  // Always an array: callers index [0] and spread it, and the old string return
  // for one branch was a standing trap.
  it("always returns an array", () => {
    for (const info of [undefined, {}, { authModes: [] }, { authModes: ["none"] }]) {
      expect(Array.isArray(providerAuthTypes(info, "whatever"))).toBe(true);
    }
  });

  // The contract this function governs, driven by the shipped registry: when an
  // entry declares its authModes, the authType it stores connections under must
  // be one this counts. A new no-auth provider that forgets it would read
  // "No connections" again, which is the bug that started this.
  //
  // Scoped to entries that declare authModes on purpose. Eight registry entries
  // declare none at all (the TTS/local ones, grok-web, perplexity-web) and so
  // fall through to the oauth default; they are rendered by the media-provider
  // and cookie-provider pages, which do their own counting and do not call this.
  // Widening the default to cover them would change cards this change is not
  // about, so it is left alone rather than quietly altered.
  it("counts the authType of every registry provider that declares its modes", () => {
    expect(PROVIDER_REGISTRY.length).toBeGreaterThan(20);
    const declared = PROVIDER_REGISTRY.filter((info) => Array.isArray(info?.authModes) && info?.authType);
    expect(declared.length).toBeGreaterThan(10);

    const missed = [];
    for (const info of declared) {
      // The real tables the page passes — stubbing them out would test a
      // configuration the dashboard never runs.
      const counted = providerAuthTypes(info, info.id, {
        freeTier: FREE_TIER_PROVIDERS,
        apiKey: APIKEY_PROVIDERS,
      });
      // "apikey"/"api_key" are interchangeable spellings of one mode.
      const wanted = info.authType === "api_key" ? "apikey" : info.authType;
      if (!counted.includes(info.authType) && !counted.includes(wanted)) {
        missed.push(`${info.id} (authType=${info.authType}, authModes=${JSON.stringify(info.authModes)})`);
      }
    }
    expect(missed).toEqual([]);
  });

  // Named explicitly: these are the shipped providers the regression hid.
  it("counts the no-auth providers that were reading No connections", () => {
    for (const id of ["claude-cli"]) {
      const info = PROVIDER_REGISTRY.find((entry) => entry.id === id);
      expect(info, `${id} missing from the registry`).toBeTruthy();
      expect(providerAuthTypes(info, id)).toContain(info.authType);
    }
  });
});

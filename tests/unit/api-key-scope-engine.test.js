import { describe, it, expect } from "vitest";
import {
  isScopeUnrestricted,
  isProviderAllowed,
  isModelAllowed,
  isFullModelIdAllowed,
  normalizeScopeInput,
} from "../../src/lib/apiKeyScope.js";

describe("apiKeyScope — back-compat (null scope)", () => {
  it("treats null/undefined scope as fully unrestricted", () => {
    expect(isScopeUnrestricted(null)).toBe(true);
    expect(isScopeUnrestricted(undefined)).toBe(true);
    expect(isProviderAllowed(null, "anthropic")).toBe(true);
    expect(isModelAllowed(null, "anthropic", "claude-sonnet-4-5")).toBe(true);
    expect(isFullModelIdAllowed(null, "anthropic/claude-sonnet-4-5")).toBe(true);
  });
});

describe("apiKeyScope — providers axis", () => {
  it("allows only listed providers when providers array is set", () => {
    const scope = { providers: ["anthropic"] };
    expect(isProviderAllowed(scope, "anthropic")).toBe(true);
    expect(isProviderAllowed(scope, "openai")).toBe(false);
  });

  it("providers:[] denies every provider (explicit lockdown)", () => {
    const scope = { providers: [] };
    expect(isProviderAllowed(scope, "anthropic")).toBe(false);
  });

  it("absent providers axis allows all providers", () => {
    const scope = { models: ["anthropic/claude-sonnet-4-5"] };
    expect(isProviderAllowed(scope, "openai")).toBe(true);
  });
});

describe("apiKeyScope — models axis, AND semantics with providers", () => {
  it("provider selected + empty models = all models of that provider", () => {
    const scope = { providers: ["anthropic"], models: [] };
    expect(isModelAllowed(scope, "anthropic", "claude-sonnet-4-5")).toBe(true);
    expect(isModelAllowed(scope, "anthropic", "claude-haiku-4-5")).toBe(true);
  });

  it("provider selected + specific model = only that model", () => {
    const scope = { providers: ["anthropic"], models: ["anthropic/claude-sonnet-4-5"] };
    expect(isModelAllowed(scope, "anthropic", "claude-sonnet-4-5")).toBe(true);
    expect(isModelAllowed(scope, "anthropic", "claude-haiku-4-5")).toBe(false);
  });

  it("models entries scoped to a different provider produce an empty intersection", () => {
    const scope = { providers: ["anthropic"], models: ["openai/gpt-4"] };
    expect(isModelAllowed(scope, "anthropic", "claude-sonnet-4-5")).toBe(false);
  });

  it("provider not in scope denies regardless of models axis", () => {
    const scope = { providers: ["anthropic"], models: ["openai/gpt-4"] };
    expect(isModelAllowed(scope, "openai", "gpt-4")).toBe(false);
  });
});

describe("apiKeyScope — free/no-auth providers get no bypass", () => {
  // "mimo-free" is a real no-auth provider (registry: category "free", noAuth: true).
  // Scoping must treat it like any other provider — no implicit access.
  it("a scoped key without the free provider listed cannot reach it", () => {
    const scope = { providers: ["anthropic"] };
    expect(isProviderAllowed(scope, "mimo-free")).toBe(false);
  });

  it("explicitly including the free provider allows it", () => {
    const scope = { providers: ["anthropic", "mimo-free"] };
    expect(isProviderAllowed(scope, "mimo-free")).toBe(true);
  });
});

describe("apiKeyScope — isFullModelIdAllowed (catalog id shape)", () => {
  it("checks provider/model catalog ids against scope", () => {
    const scope = { providers: ["anthropic"], models: [] };
    expect(isFullModelIdAllowed(scope, "anthropic/claude-sonnet-4-5")).toBe(true);
    expect(isFullModelIdAllowed(scope, "openai/gpt-4")).toBe(false);
  });

  it("ids without a provider prefix (combos) are denied under a restricted scope", () => {
    const scope = { providers: ["anthropic"] };
    expect(isFullModelIdAllowed(scope, "my-combo")).toBe(false);
  });

  it("ids without a provider prefix pass through when scope is unrestricted", () => {
    expect(isFullModelIdAllowed(null, "my-combo")).toBe(true);
  });
});

describe("apiKeyScope — normalizeScopeInput", () => {
  it("collapses an empty object (no axes) to null", () => {
    expect(normalizeScopeInput({})).toBe(null);
  });

  it("passes null/undefined through as null", () => {
    expect(normalizeScopeInput(null)).toBe(null);
    expect(normalizeScopeInput(undefined)).toBe(null);
  });

  it("filters out non-string / malformed entries", () => {
    const out = normalizeScopeInput({ providers: ["anthropic", "", 42, null], models: ["anthropic/claude-sonnet-4-5", "no-slash", 7] });
    expect(out.providers).toEqual(["anthropic"]);
    expect(out.models).toEqual(["anthropic/claude-sonnet-4-5"]);
  });

  it("keeps an explicit empty providers array (lockdown) rather than collapsing to null", () => {
    const out = normalizeScopeInput({ providers: [] });
    expect(out).toEqual({ providers: [] });
  });
});

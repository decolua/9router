/**
 * Frontier for All: registry wiring, device-flow login, and the two behaviours
 * that are easy to get wrong — rotating refresh tokens and the 402 "no provider
 * key connected" state, which is a user problem, not an auth failure.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { OAUTH_ENDPOINTS } from "../../open-sse/config/appConstants.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { refreshFrontierToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { isUnrecoverableRefreshError } from "../../open-sse/services/tokenRefresh.js";
import { classifyOAuthProbeResult } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { fetchSuggestedModels } from "../../src/shared/utils/providerModelsFetcher.js";

const HOST = "https://frontier-for-all.vercel.app";

describe("Frontier for All registry entry", () => {
  const entry = REGISTRY.find((e) => e.id === "frontier-for-all");

  it("is a free-tier OAuth provider on the OpenAI-compatible proxy endpoint", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("freeTier");
    expect(entry.authModes).toEqual(["oauth"]);
    expect(entry.hasOAuth).toBe(true);
    expect(PROVIDERS["frontier-for-all"].baseUrl).toBe(`${HOST}/api/v1/chat/completions`);
    expect(PROVIDERS["frontier-for-all"].format).toBe("openai");
  });

  it("resolves from both its alias and its id", () => {
    expect(resolveProviderAlias("ffa")).toBe("frontier-for-all");
    expect(resolveProviderAlias("frontier")).toBe("frontier-for-all");
    expect(resolveProviderAlias("frontier-for-all")).toBe("frontier-for-all");
  });

  it("passes model ids through — Frontier runs the user's dashboard choice, not ours", () => {
    expect(entry.passthroughModels).toBe(true);
    expect((PROVIDER_MODELS.ffa || []).map((m) => m.id)).toEqual(["auto"]);
  });

  it("declares the RFC 8628 device endpoints and the inference scope", () => {
    const oauth = PROVIDER_OAUTH["frontier-for-all"];
    expect(oauth.deviceCodeUrl).toBe(`${HOST}/device/code`);
    expect(oauth.deviceTokenUrl).toBe(`${HOST}/device/token`);
    expect(oauth.tokenUrl).toBe(`${HOST}/token`);
    expect(oauth.scope).toBe("inference");
    expect(oauth.clientId).toBe("07b329d7-59a0-429d-8037-0f036b7b1efb");
    // Public client: a client secret must never ship here.
    expect(oauth.clientSecret).toBeUndefined();
    expect(OAUTH_ENDPOINTS["frontier-for-all"].token).toBe(`${HOST}/token`);
  });

  it("offers Frontier's catalogue as manual additions, not as shipped models", () => {
    const f = entry.modelsFetcher;
    expect(f.type).toBe("static");
    // Static because Frontier has no public catalogue endpoint to fetch.
    expect(f.url).toBeUndefined();

    const ids = f.models.map((m) => m.id);
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
    // One id per upstream provider, spot-checked against lib/providers/index.ts
    expect(ids).toContain("llama-3.3-70b-versatile");        // groq
    expect(ids).toContain("qwen-3-32b");                     // cerebras
    expect(ids).toContain("codestral-latest");               // mistral
    expect(ids).toContain("google/gemma-3-27b-it:free");     // openrouter
    // Same family, different id per provider — both have to be listed.
    expect(ids).toContain("openai/gpt-oss-120b");            // groq
    expect(ids).toContain("gpt-oss-120b");                   // cerebras

    // None of them are in `models`, or they would look like they just work.
    const shipped = new Set((PROVIDER_MODELS.ffa || []).map((m) => m.id));
    expect(ids.every((id) => !shipped.has(id))).toBe(true);
  });

  it("tells the user a named model needs the hint toggle, the right provider, and its key", () => {
    const notice = entry.modelsFetcher.notice;
    expect(notice).toMatch(/suggest a model/i);
    expect(notice).toMatch(/consent|connected apps/i);
    expect(notice).toMatch(/key is connected/i);
    // The constraint that is easiest to get wrong: a hint cannot change provider.
    expect(notice).toMatch(/never the provider/i);
    expect(notice).toMatch(/groq/i);
  });

  it("names the upstream provider on every catalogue entry", () => {
    // Ids are only usable a provider at a time, so the name has to say which.
    for (const m of entry.modelsFetcher.models) {
      expect(m.name).toMatch(/\((Groq|Cerebras|Mistral|OpenRouter)\)$/);
    }
  });

  it("resolves the static catalogue without a network call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const models = await fetchSuggestedModels(entry.modelsFetcher);
    expect(models).toHaveLength(16);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Frontier token refresh (rotating refresh tokens)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  beforeEach(() => { vi.restoreAllMocks(); });

  it("persists the rotated refresh token instead of the one it sent", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "frnt_at_new",
        refresh_token: "frnt_rt_rotated",
        expires_in: 3600,
      }),
    }));

    const result = await refreshFrontierToken("frnt_rt_old");
    expect(result).toMatchObject({
      accessToken: "frnt_at_new",
      refreshToken: "frnt_rt_rotated",
      expiresIn: 3600,
    });

    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`${HOST}/token`);
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("frnt_rt_old");
    // Public client — sending a secret (or the string "undefined") fails auth.
    expect(body.has("client_secret")).toBe(false);
  });

  it("reports invalid_grant as unrecoverable so we re-login instead of replaying a retired token", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        error: "invalid_grant",
        error_description: "Refresh token already rotated; family revoked.",
      }),
    }));

    const result = await refreshFrontierToken("frnt_rt_reused");
    expect(isUnrecoverableRefreshError(result)).toBe(true);
  });

  it("returns null (retryable) on a transient server error", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "upstream unavailable",
    }));

    expect(await refreshFrontierToken("frnt_rt_transient")).toBeNull();
  });

  it("collapses concurrent refreshes of the same token into one upstream call", async () => {
    // Two parallel refreshes would replay a rotated token and get the whole
    // token family revoked; dedupRefresh is what keeps them serial.
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "frnt_at_1", refresh_token: "frnt_rt_1", expires_in: 3600 }),
    }));

    const [a, b] = await Promise.all([
      refreshFrontierToken("frnt_rt_concurrent"),
      refreshFrontierToken("frnt_rt_concurrent"),
    ]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});

describe("Frontier connection probe", () => {
  const PROBE = {
    url: `${HOST}/api/v1/models`,
    acceptStatuses: [402],
    softFailMessage: {
      402: "Connected, but no provider key is set up on your Frontier dashboard. Connect one at frontier-for-all.vercel.app/dashboard.",
    },
  };

  it("treats 200 as success", () => {
    expect(classifyOAuthProbeResult({ ok: true, status: 200 }, PROBE, "")).toEqual({
      valid: true, error: null, soft: false,
    });
  });

  it("treats 402 (no provider key connected) as soft success — the token is fine", () => {
    const body = JSON.stringify({ error: { message: "No provider key connected", type: "no_provider_key" } });
    const r = classifyOAuthProbeResult({ ok: false, status: 402 }, PROBE, body);
    expect(r.valid).toBe(true);
    expect(r.soft).toBe(true);
    expect(r.error).toMatch(/provider key/i);
  });

  it("treats 401 as a hard auth failure", () => {
    expect(classifyOAuthProbeResult({ ok: false, status: 401 }, PROBE, "")).toEqual({
      valid: false, error: "Token invalid or revoked", soft: false,
    });
  });
});

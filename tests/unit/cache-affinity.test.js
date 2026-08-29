import { beforeEach, describe, expect, it } from "vitest";

import { extractClientSessionId } from "../../open-sse/utils/sessionManager.js";
import {
  clearCacheAffinity,
  createCacheAffinityScope,
  getCacheAffinityPreference,
  rememberCacheAffinity,
} from "../../src/sse/services/cacheAffinity.js";

beforeEach(() => {
  clearCacheAffinity();
});

describe("cache affinity session identity", () => {
  it("uses stable session fields but excludes request IDs", () => {
    expect(extractClientSessionId(
      { "x-client-request-id": "request-1" },
      {},
      "codex",
      { includeRequestId: false },
    )).toBeNull();
    expect(extractClientSessionId(
      { "x-session-id": "session-1", "x-client-request-id": "request-1" },
      {},
      "codex",
      { includeRequestId: false },
    )).toBe("session-1");
    expect(extractClientSessionId(
      {},
      { prompt_cache_key: "prompt-cache-1" },
      "codex",
      { includeRequestId: false },
    )).toBe("prompt-cache-1");
  });
});

describe("cache affinity state", () => {
  const base = {
    provider: "codex",
    model: "gpt-5.6-sol",
    apiKey: "sk-secret",
  };

  it("uses session, then client, then API-key scope without retaining raw identity", () => {
    const session = createCacheAffinityScope({
      ...base,
      fingerprint: "client-secret",
      sessionId: "session-secret",
    });
    const sessionWithoutClient = createCacheAffinityScope({ ...base, sessionId: "session-secret" });
    const client = createCacheAffinityScope({ ...base, fingerprint: "client-secret" });
    const apiKey = createCacheAffinityScope(base);

    expect(session.level).toBe("session");
    expect(sessionWithoutClient.level).toBe("session");
    expect(client.level).toBe("client");
    expect(apiKey.level).toBe("api-key");
    expect(new Set([session.key, sessionWithoutClient.key, client.key, apiKey.key]).size).toBe(4);
    expect(JSON.stringify([session, sessionWithoutClient, client, apiKey])).not.toMatch(/sk-secret|client-secret|session-secret/);
  });

  it("isolates provider and model and rejects incomplete inputs", () => {
    const first = createCacheAffinityScope(base);
    expect(createCacheAffinityScope({ ...base, provider: "github" }).key).not.toBe(first.key);
    expect(createCacheAffinityScope({ ...base, model: "gpt-5.6-terra" }).key).not.toBe(first.key);
    expect(createCacheAffinityScope({ ...base, apiKey: "" })).toBeNull();
    expect(createCacheAffinityScope({ ...base, provider: "" })).toBeNull();
    expect(createCacheAffinityScope({ ...base, model: "" })).toBeNull();
  });

  it("expires at fixed scope TTL without extending expiry on reads", () => {
    const scope = createCacheAffinityScope({ ...base, fingerprint: "client-1" });
    const now = 1_000;
    rememberCacheAffinity(scope, "account-a", now);

    expect(getCacheAffinityPreference(scope, now + 1_000)).toBe("account-a");
    expect(getCacheAffinityPreference(scope, now + scope.ttlMs - 1)).toBe("account-a");
    expect(getCacheAffinityPreference(scope, now + scope.ttlMs)).toBeNull();
  });

  it("repins a successful replacement with a fresh absolute TTL", () => {
    const scope = createCacheAffinityScope({ ...base, fingerprint: "client-1" });
    const now = 1_000;
    rememberCacheAffinity(scope, "account-a", now);
    rememberCacheAffinity(scope, "account-b", now + 5_000);

    expect(getCacheAffinityPreference(scope, now + scope.ttlMs)).toBe("account-b");
    expect(getCacheAffinityPreference(scope, now + 5_000 + scope.ttlMs)).toBeNull();
  });

  it("evicts least-recently-used entries at the fixed capacity", () => {
    const scopes = [];
    for (let index = 0; index < 5_000; index += 1) {
      const scope = createCacheAffinityScope({ ...base, apiKey: `key-${index}` });
      scopes.push(scope);
      rememberCacheAffinity(scope, `account-${index}`, 1_000);
    }
    expect(getCacheAffinityPreference(scopes[0], 2_000)).toBe("account-0");

    const overflow = createCacheAffinityScope({ ...base, apiKey: "key-overflow" });
    rememberCacheAffinity(overflow, "account-overflow", 2_000);

    expect(getCacheAffinityPreference(scopes[0], 2_000)).toBe("account-0");
    expect(getCacheAffinityPreference(scopes[1], 2_000)).toBeNull();
    expect(getCacheAffinityPreference(overflow, 2_000)).toBe("account-overflow");
  });
});

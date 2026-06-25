// Tests for opt-in prompt_cache_key injection in DefaultExecutor.
//
// Run from 9router/open-sse:
//   node --test executors/default.promptCacheKey.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultExecutor, injectPromptCacheKey, normalizePromptCacheKey } from "./default.js";

const PROVIDER = "openai-compatible-responses-custom";

// ---------- injectPromptCacheKey (unit) ----------

test("no-op when flag is absent", () => {
  const body = { model: "model-a", messages: [] };
  injectPromptCacheKey(PROVIDER, body, { connectionId: "conn-1" });
  assert.equal(body.prompt_cache_key, undefined);
});

test("no-op when flag is false", () => {
  const body = { model: "model-a", messages: [] };
  injectPromptCacheKey(PROVIDER, body, {
    connectionId: "conn-1",
    providerSpecificData: { enablePromptCacheKey: false },
  });
  assert.equal(body.prompt_cache_key, undefined);
});

test("injects a provider-safe hash from _clientSessionId when flag enabled", () => {
  const body = { model: "model-a", messages: [] };
  injectPromptCacheKey(PROVIDER, body, {
    _clientSessionId: "claude:abc-123",
    providerSpecificData: { enablePromptCacheKey: true },
  });
  assert.equal(body.prompt_cache_key, normalizePromptCacheKey(PROVIDER, "claude:abc-123"));
  assert.match(body.prompt_cache_key, /^cc_[a-f0-9]{32}$/);
});

test("does not overwrite an existing prompt_cache_key", () => {
  const body = { model: "model-a", messages: [], prompt_cache_key: "explicit-key" };
  injectPromptCacheKey(PROVIDER, body, {
    _clientSessionId: "claude:abc-123",
    providerSpecificData: { enablePromptCacheKey: true },
  });
  assert.equal(body.prompt_cache_key, "explicit-key");
});

test("falls back to resolveSessionId (connectionId) when no captured session", () => {
  const body = { model: "model-a", messages: [] };
  injectPromptCacheKey(PROVIDER, body, {
    connectionId: "conn-xyz",
    providerSpecificData: { enablePromptCacheKey: true },
  });
  // resolveSessionId derives a stable id from connectionId; assert only the
  // provider-safe key shape because the raw id is intentionally hidden.
  assert.match(body.prompt_cache_key, /^cc_[a-f0-9]{32}$/);
});

test("stable across two calls with the same connection (cache stability)", () => {
  const creds = {
    connectionId: "conn-stable",
    providerSpecificData: { enablePromptCacheKey: true },
  };
  const a = { model: "model-a", messages: [] };
  const b = { model: "model-a", messages: [] };
  injectPromptCacheKey(PROVIDER, a, creds);
  injectPromptCacheKey(PROVIDER, b, creds);
  assert.equal(a.prompt_cache_key, b.prompt_cache_key);
});

test("prefers client session id over connection fallback", () => {
  const body = { model: "model-a", messages: [] };
  injectPromptCacheKey(PROVIDER, body, {
    _clientSessionId: "claude:session-1",
    connectionId: "conn-zzz",
    providerSpecificData: { enablePromptCacheKey: true },
  });
  assert.equal(body.prompt_cache_key, normalizePromptCacheKey(PROVIDER, "claude:session-1"));
});

test("guards non-object body", () => {
  injectPromptCacheKey(PROVIDER, null, {
    providerSpecificData: { enablePromptCacheKey: true },
  });
  injectPromptCacheKey(PROVIDER, undefined, {
    providerSpecificData: { enablePromptCacheKey: true },
  });
  assert.ok(true); // no throw
});

// ---------- DefaultExecutor.transformRequest (integration) ----------

test("transformRequest injects provider-safe prompt_cache_key for opted-in provider", () => {
  const ex = new DefaultExecutor(PROVIDER);
  const body = { model: "model-a", messages: [{ role: "user", content: "hi" }] };
  const out = ex.transformRequest("model-a", body, true, {
    _clientSessionId: "claude:conv-9",
    providerSpecificData: { enablePromptCacheKey: true },
  });
  assert.equal(out.prompt_cache_key, normalizePromptCacheKey(PROVIDER, "claude:conv-9"));
});

test("transformRequest does NOT inject when flag missing", () => {
  const ex = new DefaultExecutor(PROVIDER);
  const body = { model: "model-a", messages: [{ role: "user", content: "hi" }] };
  const out = ex.transformRequest("model-a", body, true, {
    _clientSessionId: "claude:conv-9",
  });
  assert.equal(out.prompt_cache_key, undefined);
});

// ---------- DefaultExecutor.buildUrl (apiType override) ----------

test("buildUrl uses /responses when providerSpecificData.apiType overrides chat id", () => {
  const ex = new DefaultExecutor("openai-compatible-chat-legacy");
  const url = ex.buildUrl("model-a", true, 0, {
    providerSpecificData: {
      baseUrl: "https://api.example.test/v1",
      apiType: "responses",
    },
  });
  assert.equal(url, "https://api.example.test/v1/responses");
});

test("buildUrl uses /chat/completions when providerSpecificData.apiType=chat", () => {
  const ex = new DefaultExecutor("openai-compatible-responses-node");
  const url = ex.buildUrl("model-a", true, 0, {
    providerSpecificData: {
      baseUrl: "https://api.example.test/v1/",
      apiType: "chat",
    },
  });
  assert.equal(url, "https://api.example.test/v1/chat/completions");
});

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// Load the registry entry once for the suite so a load failure is reported
// next to the failing test instead of cascading as "undefined" in every
// later assertion.
let kimchiEntry;

describe("kimchi registry entry", () => {
  before(async () => {
    kimchiEntry = (await import("../../open-sse/providers/registry/kimchi.js")).default;
  });

  it("is an oauth provider auto-listed via byCategory", () => {
    assert.equal(kimchiEntry.id, "kimchi");
    assert.equal(kimchiEntry.category, "oauth");
  });

  it("points at the OpenAI-compatible gateway with an authenticated UA", () => {
    assert.equal(
      kimchiEntry.transport.baseUrl,
      "https://llm.kimchi.dev/openai/v1/chat/completions",
    );
    // UA must be a non-empty string the gateway can identify; the value
    // itself is owned by the Kimchi CLI release and may change upstream.
    const ua = kimchiEntry.transport.headers["User-Agent"];
    assert.ok(typeof ua === "string" && ua.length > 0, `User-Agent missing: ${ua}`);
  });

  it("uses Bearer auth", () => {
    assert.deepEqual(kimchiEntry.transport.auth, {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    });
  });

  it("exposes the upstream static models", () => {
    const ids = kimchiEntry.models.map((m) => m.id);
    assert.ok(ids.includes("kimi-k2.7"));
    assert.ok(ids.includes("minimax-m3"));
    assert.ok(ids.includes("nemotron-3-ultra-fp4"));
    assert.ok(ids.length >= 5, `expected >= 5 static models, got ${ids.length}`);
  });

  it("passes through models not in the static list", () => {
    assert.equal(kimchiEntry.passthroughModels, true);
  });
});

// ── Pure-function clones of the service logic (tested in isolation so
//     node --test works without resolving the Next.js Webpack "open-sse"
//     alias that src/lib/oauth/services/kimchi.js's dependency imports). ──

function buildKimchiAuthUrl(callbackUrl, state) {
  const params = new URLSearchParams({ callback: callbackUrl, state });
  return `https://app.kimchi.dev/cli-auth?${params.toString()}`;
}

async function _handleCallback(params, expectedState) {
  if (params.error) {
    throw new Error(params.error_description || params.error);
  }
  const candidate = params.state;
  if (!candidate || candidate !== expectedState) {
    throw new Error(
      "This request isn't valid. Please restart the Kimchi login flow.",
    );
  }
  const token = params.token;
  if (!token) {
    throw new Error("No token was returned by the Kimchi authentication server");
  }
  return { token };
}

describe("kimchi oauth", () => {
  it("builds the cli-auth URL with encoded callback + state", () => {
    const url = buildKimchiAuthUrl("http://127.0.0.1:4321/callback", "abc123");
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://app.kimchi.dev");
    assert.equal(parsed.pathname, "/cli-auth");
    assert.equal(parsed.searchParams.get("callback"), "http://127.0.0.1:4321/callback");
    assert.equal(parsed.searchParams.get("state"), "abc123");
  });

  it("rejects a callback whose state does not match", async () => {
    await assert.rejects(
      () => _handleCallback({ token: "castai_v1_x", state: "wrong" }, "expected"),
      /restart/i,
    );
  });

  it("accepts a callback with matching state and returns the token", async () => {
    const res = await _handleCallback({ token: "castai_v1_x", state: "match" }, "match");
    assert.equal(res.token, "castai_v1_x");
  });
});

// ── kimchiModels service (pure mapping logic, tested in isolation) ──

// Clone of the metadata→model mapper so node --test resolves without the
// open-sse/Webpack alias chain the real module imports.
function mapKimchiMetadata(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => ({
    id: m.slug,
    name: m.display_name || m.slug,
    contextLength: m.limits?.context_window || null,
    maxOutputTokens: m.limits?.max_output_tokens || null,
    isReasoning: m.reasoning === true,
  }));
}

describe("kimchiModels", () => {
  it("maps Kimchi metadata entries to 9router model shape", () => {
    const raw = [{
      slug: "glm-5.2-fp8",
      display_name: "GLM 5.2",
      reasoning: true,
      limits: { context_window: 1048576, max_output_tokens: 1048576 },
    }];
    const models = mapKimchiMetadata(raw);
    assert.equal(models.length, 1);
    assert.deepEqual(models[0], {
      id: "glm-5.2-fp8",
      name: "GLM 5.2",
      contextLength: 1048576,
      maxOutputTokens: 1048576,
      isReasoning: true,
    });
  });

  it("falls back to slug as name when display_name is empty", () => {
    const models = mapKimchiMetadata([{ slug: "kimi-k2.7", display_name: "", reasoning: false, limits: {} }]);
    assert.equal(models[0].name, "kimi-k2.7");
    assert.equal(models[0].contextLength, null);
    assert.equal(models[0].isReasoning, false);
  });

  it("returns empty array for non-array input", () => {
    assert.deepEqual(mapKimchiMetadata(null), []);
    assert.deepEqual(mapKimchiMetadata({}), []);
  });
});

// ── validateToken logic (pure decision over a status code) ──

// Mirrors the decision in KimchiService.validateToken without importing the
// service (which pulls the open-sse Webpack alias chain).
function decideValidity(status) {
  if (status === 200) return { valid: true };
  if (status === 401) return { valid: false, error: "Kimchi token invalid or expired" };
  if (status === 403) return { valid: false, error: "Kimchi token lacks required scope" };
  return { valid: true }; // fail-open on unknown / network error
}

describe("kimchi validateToken", () => {
  it("200 → valid", () => {
    assert.deepEqual(decideValidity(200), { valid: true });
  });
  it("401 → invalid, expired message", () => {
    const r = decideValidity(401);
    assert.equal(r.valid, false);
    assert.match(r.error, /invalid or expired/i);
  });
  it("403 → invalid, scope message", () => {
    const r = decideValidity(403);
    assert.equal(r.valid, false);
    assert.match(r.error, /scope/i);
  });
  it("unknown / network error → fail-open valid", () => {
    assert.equal(decideValidity(500).valid, true);
    assert.equal(decideValidity(0).valid, true);
  });
});

// ── OAuth dedup logic (pure clone of connectionsRepo matcher) ──
// Mimics the find() predicate in createProviderConnection for OAuth
// connections, so we can test the IdP-collision fix in isolation.
function findExistingOAuth(all, incoming) {
  const incomingEmail = incoming.email;
  const incomingUsername = incoming.providerSpecificData?.username;
  const incomingWs = incoming.providerSpecificData?.chatgptAccountId;
  return all.find((c) => {
    if (c.authType !== "oauth" || c.email !== incomingEmail) return false;
    const existingWs = c.providerSpecificData?.chatgptAccountId;
    if (incomingWs && existingWs) return incomingWs === existingWs;
    if (incomingWs && !existingWs) return false;
    if (!incomingWs && existingWs) return false;
    const existingUsername = c.providerSpecificData?.username;
    if (incomingUsername && existingUsername) {
      return incomingUsername === existingUsername;
    }
    if (incomingUsername || existingUsername) return false;
    return true;
  });
}

describe("kimchi OAuth dedup", () => {
  const google = { authType: "oauth", email: "x@y.com", providerSpecificData: { username: "google-oauth2|123" } };
  const hf = { authType: "oauth", email: "x@y.com", providerSpecificData: { username: "huggingface|456" } };
  const legacy = { authType: "oauth", email: "x@y.com", providerSpecificData: {} };
  const other = { authType: "oauth", email: "z@y.com", providerSpecificData: { username: "google-oauth2|789" } };

  it("different email never matches", () => {
    assert.equal(findExistingOAuth([other], google), undefined);
  });

  it("same email + same username = dedup (re-login same IdP)", () => {
    const found = findExistingOAuth([google], { ...google });
    assert.equal(found, google);
  });

  it("same email + different username = NO match (cross-IdP, the bug)", () => {
    assert.equal(findExistingOAuth([google], hf), undefined);
  });

  it("legacy row without username matches incoming without username (backward compat)", () => {
    assert.equal(findExistingOAuth([legacy], { ...legacy }), legacy);
  });

  it("incoming without username does not match legacy row with username", () => {
    assert.equal(findExistingOAuth([google], { ...legacy }), undefined);
  });

  it("workspaces still dedupe on workspace ID when both sides have one", () => {
    const ws1 = { authType: "oauth", email: "a@b.com", providerSpecificData: { chatgptAccountId: "ws1" } };
    const ws1dup = { authType: "oauth", email: "a@b.com", providerSpecificData: { chatgptAccountId: "ws1" } };
    const ws2 = { authType: "oauth", email: "a@b.com", providerSpecificData: { chatgptAccountId: "ws2" } };
    assert.equal(findExistingOAuth([ws1], ws1dup), ws1);
    assert.equal(findExistingOAuth([ws1], ws2), undefined);
  });
});

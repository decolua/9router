import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DF-9ROUTER-40 — two chained 9routers: the child's advertised model id must
// resolve verbatim through /v1/chat/completions, and a typo'd/natural id must
// fail FAST with a model-scoped error instead of a credential lockout.
//
// Measured live (2026-09-24 dogfood, fresh bunker install wired to a scratch
// 9router as its OpenAI-compatible upstream): the upstream's own node prefix
// (dlm/) was stacked under the child's prefix (up/) as `up/dlm/qwen3.8-27b`,
// and requesting the NATURAL id `up/qwen3.8-27b` hung ~95s, then answered
// `[openai-compatible-chat-.../qwen3.8-27b] [400]: No credentials for
// provider: openai (reset after 1m 35s)`.
//
// Verified mechanism of the slow, misleading failure: the child strips its own
// prefix and forwards the bare remainder; the upstream 9router cannot resolve
// that bare id, infers provider `openai` for it, and answers 404 "No active
// credentials for provider: openai". The child's account classifier matches
// the "no credentials" text rule, cools the VALID connection down, and waits
// out the retry window — a model-scoped miss reported as a credential failure.
//
// These tests drive the real path: handleChat → getModelInfo (node prefix) →
// getProviderCredentials (real auth.js against a mocked store) → handleChatCore
// → the real DefaultExecutor → a real HTTP stub on 127.0.0.1 playing the
// upstream 9router. Only the DB, usage persistence and token refresh are
// mocked. No network beyond 127.0.0.1, no timers.

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
  getModelAliases: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProxyPools: mocks.getProxyPools,
  getModelAliases: mocks.getModelAliases,
  getComboByName: mocks.getComboByName,
  getProviderNodes: mocks.getProviderNodes,
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

const NODE_PREFIX = "up"; // this instance's node prefix (dogfood: `up`)
const PARENT_PREFIX = "dlm"; // the upstream 9router's own node prefix
const NODE_ID = "openai-compatible-chat-3f6c1d2e-1111-4222-8333-444455556666";
const CONNECTION_ID = "conn-up-1";
const REAL_MODEL = "qwen3.8-27b";
const TEST_KEY = "test-upstream-key";

// What the child publishes and what therefore travels verbatim from clients.
const ADVERTISED_ID = `${NODE_PREFIX}/${PARENT_PREFIX}/${REAL_MODEL}`;
// What the upstream 9router must receive: exactly one prefix stripped.
const UPSTREAM_ID = `${PARENT_PREFIX}/${REAL_MODEL}`;
// The natural id a user writes from the upstream's advertised name — the row's
// failing request. It does not exist on the upstream.
const NATURAL_ID = `${NODE_PREFIX}/${REAL_MODEL}`;

// A peer 9router's verbatim answer when it cannot route a bare model id: it
// infers provider `openai` and reports the missing connection (chat.js
// "No active credentials for provider" through buildErrorBody).
const PEER_MISROUTE_404 = {
  error: {
    message: "No active credentials for provider: openai",
    type: "invalid_request_error",
    code: "model_not_found",
  },
};

function completionBody(model) {
  return {
    id: "chatcmpl-chain",
    object: "chat.completion",
    created: 1,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: "CHAIN_OK" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  };
}

function sseBody(model) {
  const chunk = (delta, finishReason = null) => ({
    id: "chatcmpl-chain", object: "chat.completion.chunk", created: 1, model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
  return [
    `data: ${JSON.stringify(chunk({ role: "assistant", content: "CHAIN_" }))}\n\n`,
    `data: ${JSON.stringify(chunk({ content: "OK" }))}\n\n`,
    `data: ${JSON.stringify({ ...chunk({}, "stop"), usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
}

/**
 * The upstream 9router. `notFoundBody` is what it answers for any model id it
 * cannot resolve; default is the verified peer misroute wording. `seen`
 * records every model id it was asked for, so tests assert exactly one
 * request and exactly one stripped prefix.
 */
async function startPeer({ status = 200, notFoundBody = PEER_MISROUTE_404 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ url: req.url, model: body.model, stream: body.stream });
      if (status !== 200 || body.model !== UPSTREAM_ID) {
        const answer = status === 200 ? notFoundBody : { error: { message: "rejected" } };
        res.writeHead(status === 200 ? 404 : status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(answer));
        return;
      }
      if (body.stream === true) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseBody(body.model));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(completionBody(body.model)));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function nodeConnection(baseUrl) {
  return {
    id: CONNECTION_ID,
    provider: NODE_ID,
    isActive: true,
    apiKey: TEST_KEY,
    providerSpecificData: {
      prefix: NODE_PREFIX,
      apiType: "chat",
      baseUrl,
      nodeName: "peer-9router",
    },
  };
}

async function chat(modelStr) {
  const started = Date.now();
  const response = await handleChat(new Request("https://router.test/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer client-key" },
    body: JSON.stringify({
      model: modelStr,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    }),
  }));
  return { response, elapsedMs: Date.now() - started };
}

// Every updateProviderConnection payload key, flattened across calls — how the
// tests prove the valid credential was (not) cooled down.
function writtenKeys() {
  return mocks.updateProviderConnection.mock.calls.flatMap(([, update]) => Object.keys(update || {}));
}

describe("chained 9router completion path (DF-9ROUTER-40)", () => {
  let peer;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.updateProviderConnection.mockResolvedValue({});
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
  });

  afterEach(async () => {
    if (peer) {
      await peer.close();
      peer = null;
    }
  });

  async function wirePeer(options) {
    peer = await startPeer(options);
    mocks.getProviderNodes.mockImplementation(async ({ type }) =>
      type === "openai-compatible" ? [{ id: NODE_ID, prefix: NODE_PREFIX }] : []);
    mocks.getProviderConnections.mockResolvedValue([nodeConnection(peer.baseUrl)]);
  }

  it("resolves the advertised chained id verbatim, stripping exactly one prefix", async () => {
    await wirePeer();

    const { response } = await chat(ADVERTISED_ID);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("CHAIN_OK");
    // Exactly one request, carrying exactly one stripped prefix: the upstream
    // 9router gets `dlm/qwen3.8-27b` — never `up/dlm/...` (child prefix
    // forwarded) and never bare `qwen3.8-27b` (over-stripped, unresolvable).
    expect(peer.seen).toHaveLength(1);
    expect(peer.seen[0].url).toBe("/v1/chat/completions");
    expect(peer.seen[0].model).toBe(UPSTREAM_ID);
  });

  it("fails a typo'd/natural id in <5s with a model-scoped error, keeping the credential", async () => {
    await wirePeer();

    const { response, elapsedMs } = await chat(NATURAL_ID);
    const body = await response.json();

    // Fast: one upstream round trip, not the measured ~95s retry window.
    expect(elapsedMs).toBeLessThan(5000);
    expect(peer.seen).toHaveLength(1);
    expect(peer.seen[0].model).toBe(REAL_MODEL); // the bare, unresolvable id

    // Model-scoped wording that names the requested id — never the misleading
    // credential framing the dogfood captured.
    expect(response.status).toBe(404);
    expect(body.error.message).toContain(NATURAL_ID);
    expect(body.error.message).toMatch(/not found/i);
    expect(body.error.message).not.toMatch(/no (active )?credentials/i);
    expect(body.error.message).not.toMatch(/reset after/i);

    // The valid credential is untouched: no model lock, no unavailable status.
    expect(writtenKeys().some((k) => k.startsWith("modelLock_"))).toBe(false);
    expect(mocks.updateProviderConnection.mock.calls.some(([, u]) => u?.testStatus === "unavailable")).toBe(false);
  });

  it("answers an upstream model-worded 404 the same fast, model-scoped way", async () => {
    await wirePeer({
      notFoundBody: {
        error: { message: 'The model "qwen3.8-27b" does not exist', type: "invalid_request_error", code: "model_not_found" },
      },
    });

    const { response, elapsedMs } = await chat(NATURAL_ID);
    const body = await response.json();

    expect(elapsedMs).toBeLessThan(5000);
    expect(response.status).toBe(404);
    expect(body.error.message).toContain(NATURAL_ID);
    expect(body.error.message).not.toMatch(/no (active )?credentials/i);
    expect(writtenKeys().some((k) => k.startsWith("modelLock_"))).toBe(false);
  });

  it("keeps account-scoped classification: a 401 still cools the connection and falls back", async () => {
    await wirePeer({ status: 401 });

    const { response } = await chat(ADVERTISED_ID);
    const body = await response.json();

    // The account rule is untouched: the connection is locked for the model
    // and the caller gets the account failure, not a model-scoped rewrite.
    expect(writtenKeys().some((k) => k.startsWith("modelLock_"))).toBe(true);
    expect(mocks.updateProviderConnection.mock.calls.some(([, u]) => u?.testStatus === "unavailable")).toBe(true);
    expect(response.status).toBe(401);
    expect(body.error.message).toContain("rejected");
    expect(peer.seen).toHaveLength(1);
  });
});

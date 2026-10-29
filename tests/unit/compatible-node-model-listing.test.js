import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DF-9ROUTER-35 — a custom OpenAI-compatible node must list what its upstream
// actually offers.
//
// Measured live (docs/dogfood/2026-09-20-integration.md): a node pointing at a
// healthy upstream that answered 96 model ids surfaced exactly ONE id through
// this instance's `GET /v1/models` — the single call a user makes to configure a
// CLI tool — while a completion through the same node worked.
//
// Verified mechanism: `fetchCompatibleModelIds` sent the legacy
// `x-9r-internal-models-fetch` marker on its OUTBOUND lookup. A 9router peer
// answers a request carrying that marker from its static view, deliberately
// dropping every model it learned from its own nodes — so an upstream chain of
// 9routers reports only its combos. The listing was therefore the gateway's
// *recursion guard* leaking into a normal user request.
//
// These tests drive the route's real code path: a real HTTP stub upstream on
// 127.0.0.1 (so the client's fetch, headers and body parsing are exercised) and
// the route's `GET` called directly with a web `Request` -> `Response`.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

// This file's charter is compatible-NODE prefix/alias mechanics. The static
// no-auth free-provider surface (upstream #3115, v0.5.104) leaks oc/*, mmf/* …
// ids into every expected listing, so it is silenced here — the free surface
// has its own coverage in fresh-install-model-catalog-339.test.js.
vi.mock("@/shared/constants/providers", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, FREE_PROVIDERS: {} };
});

const { GET, buildModelsListForRequest } = await import("../../src/app/api/v1/models/route.js");

const OPENAI_NODE_ID = "openai-compatible-chat-9f0c2b1a-1111-4222-8333-444455556666";
const ANTHROPIC_NODE_ID = "anthropic-compatible-5c7e4d3b-2222-4333-8444-555566667777";

// A fresh, un-synced prefix (mirrors the dogfood node's `u9`) and ids the local
// catalog has never heard of — no registry entry, no alias, no custom model.
const NODE_PREFIX = "u9";
const UPSTREAM_IDS = [
  "qwen3.8-27b",
  "glm-4.7-flash",
  "kimi-k3-preview",
  "deepseek-v4-flash",
  "gpt-oss-120b-medium",
  "muse-spark-1.3",
];

const ids = (models) => models.map((m) => m.id);

/**
 * A real, tiny OpenAI-shaped upstream. `seen` is how a test asserts what the
 * route actually sent (URL and headers) without mocking `fetch`.
 *
 * `honourRecursionMarker` reproduces the VERIFIED behaviour of a 9router peer:
 * a request carrying `x-9r-internal-models-fetch` is answered from the static
 * view, i.e. with the instance's combos alone and none of the models it learned
 * from its own nodes (that is what the guard is for — see the GET handler).
 * Defaulting it ON is what makes these tests exercise the real topology: the
 * dogfood node's upstream was another 9router.
 */
async function startUpstream({
  ids: upstreamIds = UPSTREAM_IDS,
  status = 200,
  honourRecursionMarker = true,
  comboIds = ["dogfood-fallback"],
} = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (status !== 200) {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "rejected" } }));
      return;
    }
    const internalFetch = req.headers["x-9r-internal-models-fetch"] === "1";
    const bodyIds = honourRecursionMarker && internalFetch ? comboIds : upstreamIds;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: bodyIds.map((id) => ({ id, object: "model", owned_by: "upstream" })),
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function compatibleConnection(baseUrl, {
  provider = OPENAI_NODE_ID,
  prefix = NODE_PREFIX,
  specific = {},
} = {}) {
  return {
    id: `conn-${prefix}`,
    provider,
    isActive: true,
    apiKey: "not-needed-for-a-local-upstream",
    providerSpecificData: {
      prefix,
      apiType: "chat",
      baseUrl,
      nodeName: `node-${prefix}`,
      ...specific,
    },
  };
}

async function listIds(headers = {}) {
  const response = await GET(new Request("https://router.test/v1/models", { headers }));
  const body = await response.json();
  expect(response.status).toBe(200);
  return { response, ids: ids(body.data), data: body.data };
}

describe("compatible node model listing (DF-9ROUTER-35)", () => {
  let upstream;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (upstream) {
      await upstream.close();
      upstream = null;
    }
  });

  it("lists EVERY model the upstream offers under the node prefix, with no manual catalog step", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    const { ids: listed, data } = await listIds();

    // The whole point: N models in, N models out. One id (the dogfood failure)
    // or an intersection-shaped subset both fail this assertion.
    expect(listed).toHaveLength(UPSTREAM_IDS.length);
    expect(listed).toEqual(UPSTREAM_IDS.map((id) => `${NODE_PREFIX}/${id}`));
    // ...and they are real OpenAI catalog entries, not placeholders.
    for (const entry of data) {
      expect(entry.object).toBe("model");
      expect(entry.owned_by).toBe(NODE_PREFIX);
    }
  });

  it("reads the upstream's own /models, once, WITHOUT the recursion marker", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    await listIds();

    expect(upstream.seen).toHaveLength(1);
    expect(upstream.seen[0].url).toBe("/v1/models");
    // The marker is what made a 9router peer answer with its combos alone. It
    // must not ride a discovery fetch, or a chained 9router lists one model.
    expect(upstream.seen[0].headers["x-9r-internal-models-fetch"]).toBeUndefined();
    // Cycle detection still travels, so a node cycle terminates.
    expect(upstream.seen[0].headers["x-9r-models-fetch-origin"]).toEqual(expect.any(String));
  });

  it("lists a NESTED 9router upstream's whole catalog (the dogfood topology)", async () => {
    // The upstream is itself a 9router: its /v1/models answers with combos FIRST
    // and then its own node's models. Replayed here so the assertion encodes the
    // real shape that produced the 1-id listing.
    upstream = await startUpstream({
      ids: ["dogfood-fallback", ...UPSTREAM_IDS],
    });
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    const { ids: listed } = await listIds();

    expect(listed).toEqual(["u9/dogfood-fallback", ...UPSTREAM_IDS.map((id) => `u9/${id}`)]);
    expect(listed).toHaveLength(7);
  });

  it("does the same for an anthropic-compatible node", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl, {
        provider: ANTHROPIC_NODE_ID,
        prefix: "u9a",
        specific: { apiType: undefined },
      }),
    ]);

    const { ids: listed } = await listIds();

    expect(listed).toEqual(UPSTREAM_IDS.map((id) => `u9a/${id}`));
  });

  it("keeps alias and custom-model merging for a node, without duplicating or double-prefixing", async () => {
    upstream = await startUpstream({ ids: [...UPSTREAM_IDS, UPSTREAM_IDS[0]] });
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);
    // A user-added model on this node, and an alias that points at a model the
    // upstream also lists: both are the same published id and must appear once.
    mocks.getCustomModels.mockResolvedValue([
      { id: "cu-local-1", providerAlias: OPENAI_NODE_ID },
    ]);
    mocks.getModelAliases.mockResolvedValue({
      "u9-alias": `${OPENAI_NODE_ID}/${UPSTREAM_IDS[1]}`,
    });

    const { ids: listed } = await listIds();

    expect(listed).toEqual([...UPSTREAM_IDS.map((id) => `${NODE_PREFIX}/${id}`), `${NODE_PREFIX}/cu-local-1`]);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.some((id) => id.includes(`${NODE_PREFIX}/${NODE_PREFIX}/`))).toBe(false);
  });

  it("honours an explicit enabledModels list instead of the upstream's full catalog", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl, {
        specific: { enabledModels: [UPSTREAM_IDS[2]] },
      }),
    ]);

    const { ids: listed } = await listIds();

    expect(listed).toEqual([`${NODE_PREFIX}/${UPSTREAM_IDS[2]}`]);
    // An explicit list is the user's answer: do not fan out to the upstream.
    expect(upstream.seen).toHaveLength(0);
  });

  it("keeps non-LLM upstream ids out of the default LLM listing", async () => {
    upstream = await startUpstream({
      ids: [
        UPSTREAM_IDS[0],
        "text-embedding-3-large",
        "flux-2-klein",
        "whisper-large-v3",
      ],
    });
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    const { ids: listed } = await listIds();

    // An unknown upstream id is kind-classified by the same name heuristic the
    // rest of the route uses, so an embedding/image id does not pose as a chat
    // model. `whisper-large-v3` is the documented blind spot of that heuristic
    // (no stt pattern for "whisper") and is unchanged by this fix.
    expect(listed).toEqual([
      `${NODE_PREFIX}/${UPSTREAM_IDS[0]}`,
      `${NODE_PREFIX}/whisper-large-v3`,
    ]);
  });

  it("keeps a node's own echoed ids when the upstream names it, without double-prefixing", async () => {
    // A 9router upstream can answer with an id already carrying OUR prefix (it
    // was asked for `u9/…` by a nested node). It is not "a model the node
    // defines", but it IS reachable through the node, so it must survive the
    // passthrough merge as a single-prefixed id.
    upstream = await startUpstream({
      ids: ["u9/nested-only-model", ...UPSTREAM_IDS],
    });
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    const { ids: listed } = await listIds();

    expect(listed).toContain(`${NODE_PREFIX}/nested-only-model`);
    expect(listed.some((id) => id.startsWith(`${NODE_PREFIX}/${NODE_PREFIX}/`))).toBe(false);
    expect(listed).toHaveLength(UPSTREAM_IDS.length + 1);
  });

  it("publishes a nested 9router's node-prefixed ids under the child prefix exactly once (DF-9ROUTER-40)", async () => {
    // The upstream is itself a 9router whose own node uses prefix `dlm`, so its
    // /v1/models answers `dlm/<id>` (the dogfood's `up/dlm/...` shape). The
    // child must publish exactly `u9/dlm/<id>` — one prefix added — and that
    // stacked-but-single id is the one /v1/chat/completions resolves verbatim
    // (proven end to end in compatible-node-chained-completion.test.js). An id
    // the upstream echoes already carrying OUR prefix (`u9/dlm/<id>`) is the
    // same published id again, never `u9/u9/...`.
    upstream = await startUpstream({
      ids: ["dlm/qwen3.8-27b", "u9/dlm/deepseek-v4-flash"],
    });
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    const { ids: listed } = await listIds();

    expect(listed).toEqual(["u9/dlm/qwen3.8-27b", "u9/dlm/deepseek-v4-flash"]);
    expect(listed.some((id) => id.startsWith(`${NODE_PREFIX}/${NODE_PREFIX}/`))).toBe(false);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("still answers 200 with the previous behaviour when the upstream rejects the lookup", async () => {
    upstream = await startUpstream({ status: 401 });
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    const { ids: listed } = await listIds();

    // A dead/denied upstream degrades for that node only — never a 5xx and
    // never a thrown handler.
    expect(listed).toEqual([]);
  });

  it("still answers 200 when the upstream is unreachable", async () => {
    // Nothing listening on that port: connection refused.
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection("http://127.0.0.1:1/v1"),
    ]);

    const { ids: listed } = await listIds();

    expect(listed).toEqual([]);
  });

  it("does not reach out for a node with no base URL or no credential", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(""),
      { ...compatibleConnection(upstream.baseUrl, { prefix: "u8" }), apiKey: "" },
    ]);

    const { ids: listed } = await listIds();

    expect(upstream.seen).toHaveLength(0);
    expect(listed).toEqual([]);
  });

  it("keeps answering a legacy internal /models fetch from the static view (old peer)", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    // An instance that predates the origin header still sends only the legacy
    // marker and still expects no fan-out — honouring it is what keeps a
    // partially-upgraded federation terminating.
    const { ids: listed } = await listIds({ "x-9r-internal-models-fetch": "1" });

    expect(upstream.seen).toHaveLength(0);
    expect(listed).toEqual([]);
  });

  it("answers a peer that carries an origin instead of suppressing it", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    // A new-style peer's fan-out is a real request for our catalog: it must get
    // the catalog. Blanking it here is the regression under test.
    const { ids: listed } = await listIds({ "x-9r-models-fetch-origin": "peer-instance-1" });

    expect(listed).toEqual(UPSTREAM_IDS.map((id) => `${NODE_PREFIX}/${id}`));
  });

  it("stops fanning out when a chain returns to the origin process (cycle guard)", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    // First request mints this process's origin and echoes it back. A chain that
    // comes home presenting that same origin is a cycle — terminate it.
    const first = await GET(new Request("https://router.test/v1/models"));
    const echoed = (await upstream.seen[0].headers["x-9r-models-fetch-origin"]);
    expect(echoed).toEqual(expect.any(String));
    expect(ids((await first.json()).data)).toHaveLength(UPSTREAM_IDS.length);

    const second = await GET(new Request("https://router.test/v1/models", {
      headers: { "x-9r-models-fetch-origin": echoed },
    }));
    expect(ids((await second.json()).data)).toEqual([]);
    // ...and the cycle stop did not read the upstream again.
    expect(upstream.seen).toHaveLength(1);
  });

  it("applies the same discovery to the per-kind list endpoint's LLM path", async () => {
    upstream = await startUpstream({ ids: ["qwen3.8-27b", "bge-embed-1"] });
    mocks.getProviderConnections.mockResolvedValue([
      compatibleConnection(upstream.baseUrl),
    ]);

    // Driven through `buildModelsList` — the export both the LLM route and the
    // per-kind / exact-model routes call — so this covers the shared seam without
    // changing those routes' import contract.
    const llm = await buildModelsListForRequest(null, ["llm"]);
    const embedding = await buildModelsListForRequest(null, ["embedding"]);

    // The node's real catalog reaches the LLM listing, and the embedding-
    // classified id stays out of it.
    expect(ids(llm)).toEqual(["u9/qwen3.8-27b"]);
    // Residual, unchanged by this fix: a compatible node is not listed under a
    // non-LLM kind at all, because `providerMatchesKinds` reads the registry and
    // a node id is not in it. The endpoint still answers, it just does not
    // advertise node models for that kind.
    expect(ids(embedding)).toEqual([]);
  });

  it("leaves instances with no compatible node untouched", async () => {
    upstream = await startUpstream();
    mocks.getProviderConnections.mockResolvedValue([]);

    const { ids: listed } = await listIds();

    expect(upstream.seen).toHaveLength(0);
    // No compatible node → no upstream fan-out. The only static entry a fresh
    // install advertises is the credentialless mmf/mimo-auto (UI-alias
    // resolution via ALIAS_TO_PROVIDER_ID, upstream v0.5.95) — see
    // fresh-install-model-catalog-339.test.js.
    expect(listed).toEqual(["mmf/mimo-auto"]);
  });
});

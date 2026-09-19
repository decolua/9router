// T1.5 M6 — POST /api/providers/validate probes user-controlled hosts
// (node.baseUrl / azureEndpoint) with NO fetch timeout, while the web/media
// probes (:41, :75-79) already use AbortSignal.timeout(8000). A TCP sinkhole
// (dead LAN host, black-holed IP) pins the dashboard request for minutes.
//
// The fetch stub below behaves like a real sinkhole: when handed an
// AbortSignal it rejects on abort, otherwise it NEVER settles. Every case
// races the handler against a watchdog, so an un-timed probe fails as
// "hang" instead of burning the vitest timeout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const models = vi.hoisted(() => ({ getProviderNodeById: vi.fn() }));
vi.mock("@/models", () => ({ getProviderNodeById: models.getProviderNodeById }));

const { POST } = await import("@/app/api/providers/validate/route.js");

const SINKHOLE = "http://10.255.255.1:9"; // non-routable, RFC-scratchpad-ish dead port
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const originalFetch = global.fetch;
const originalAbortTimeout = AbortSignal.timeout;

let fetchCalls; // { url, init } per call, in order
let timeouts; // { ms, ctrl } for every AbortSignal.timeout() the route registers

beforeEach(() => {
  fetchCalls = [];
  timeouts = [];
  AbortSignal.timeout = (ms) => {
    const ctrl = new AbortController();
    timeouts.push({ ms, ctrl });
    return ctrl.signal;
  };
});

afterEach(() => {
  AbortSignal.timeout = originalAbortTimeout;
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

// behaviors: index → { resolve: responseLike } to make one call answer normally;
// every other call hangs unless it was given an AbortSignal (then rejects on abort).
function installSinkhole(behaviors = {}) {
  global.fetch = vi.fn((url, init = {}) => {
    const index = fetchCalls.push({ url, init }) - 1;
    const behavior = behaviors[index];
    if (behavior?.resolve) return Promise.resolve(behavior.resolve);
    const signal = init.signal;
    if (signal && typeof signal.addEventListener === "function") {
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason || new Error("aborted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
    return new Promise(() => {}); // signal-less fetch to a dead host: hangs
  });
}

function fireTimeouts() {
  for (const { ctrl } of timeouts) {
    if (!ctrl.signal.aborted) {
      const err = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      ctrl.abort(err);
    }
  }
}

async function postValidate(body) {
  const res = await POST(
    new Request("http://localhost:20128/api/providers/validate", { method: "POST", body: JSON.stringify(body) }),
  );
  return { status: res.status, body: await res.json() };
}

// Drive one sinkhole case: handler must abandon the probe once the timeout
// signal fires, returning {valid:false} instead of pinning the request.
async function expectAbandoned(body, { callIndex = 0 } = {}) {
  installSinkhole();
  const pending = postValidate(body);
  await sleep(20); // let the probe reach fetch()
  expect(fetchCalls.length).toBeGreaterThan(callIndex); // sanity: probe fired
  fireTimeouts();
  const outcome = await Promise.race([
    pending.then(() => "resolved"),
    sleep(300).then(() => "hang"),
  ]);
  expect(outcome, "validate must not hang on an unreachable host (missing fetch timeout)").toBe("resolved");
  const result = await pending;
  expect(result.status).toBe(200);
  expect(result.body.valid).toBe(false);
  expect(result.body.error).toBeTruthy();
  // the probe to the arbitrary host must carry an AbortSignal (~8s, matching the web/media probes)
  expect(fetchCalls[callIndex].init.signal).toBeInstanceOf(AbortSignal);
  expect(timeouts.length).toBeGreaterThan(0);
  expect(timeouts.every((t) => t.ms >= 5000 && t.ms <= 10000)).toBe(true);
}

describe("POST /api/providers/validate — arbitrary-host probes must time out (M6)", () => {
  it("abandons the openai-compatible /models probe on timeout", async () => {
    models.getProviderNodeById.mockResolvedValue({ baseUrl: SINKHOLE });
    await expectAbandoned({ provider: "openai-compatible-t1", apiKey: "sk-test" });
    expect(fetchCalls[0].url).toBe(`${SINKHOLE}/models`);
  });

  it("abandons the custom-embedding /models probe on timeout", async () => {
    models.getProviderNodeById.mockResolvedValue({ baseUrl: `${SINKHOLE}/` });
    await expectAbandoned({ provider: "custom-embedding-t1", apiKey: "sk-test" });
    expect(fetchCalls[0].url).toBe(`${SINKHOLE}/models`);
  });

  it("abandons the custom-embedding /embeddings fallback probe on timeout", async () => {
    models.getProviderNodeById.mockResolvedValue({ baseUrl: SINKHOLE });
    // /models answers 500 (not definitive) → route falls through to the /embeddings probe
    installSinkhole({ 0: { resolve: { ok: false, status: 500 } } });
    const pending = postValidate({ provider: "custom-embedding-t1", apiKey: "sk-test" });
    await sleep(20);
    expect(fetchCalls.length).toBe(2);
    fireTimeouts();
    const outcome = await Promise.race([
      pending.then(() => "resolved"),
      sleep(300).then(() => "hang"),
    ]);
    expect(outcome, "embeddings fallback probe must not hang").toBe("resolved");
    const result = await pending;
    expect(result.body.valid).toBe(false);
    expect(fetchCalls[1].url).toBe(`${SINKHOLE}/embeddings`);
    expect(fetchCalls[1].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("abandons the anthropic-compatible /v1/messages probe on timeout", async () => {
    models.getProviderNodeById.mockResolvedValue({ baseUrl: SINKHOLE, defaultModel: "claude-3-haiku-20240307" });
    await expectAbandoned({ provider: "anthropic-compatible-t1", apiKey: "sk-test" });
    expect(fetchCalls[0].url).toBe(`${SINKHOLE}/v1/messages`);
  });

  it("abandons the cloudflare-ai probe on timeout", async () => {
    await expectAbandoned({
      provider: "cloudflare-ai",
      apiKey: "cf-token",
      providerSpecificData: { accountId: "acct-1" },
    });
    expect(fetchCalls[0].url).toContain("api.cloudflare.com");
  });

  it("abandons the azure endpoint probe (user-defined host) on timeout", async () => {
    await expectAbandoned({
      provider: "azure",
      apiKey: "az-key",
      providerSpecificData: { azureEndpoint: SINKHOLE, deployment: "gpt-4" },
    });
    expect(fetchCalls[0].url).toContain(SINKHOLE);
  });

  it("keeps the success shape intact and still carries a timeout on /models", async () => {
    models.getProviderNodeById.mockResolvedValue({ baseUrl: SINKHOLE });
    installSinkhole({ 0: { resolve: { ok: true, status: 200 } } });
    const result = await postValidate({ provider: "openai-compatible-t1", apiKey: "sk-test" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ valid: true, error: null });
    expect(fetchCalls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(timeouts.map((t) => t.ms)).toContain(8000);
  });

  it("keeps the azure success shape intact (non-401/403 → valid)", async () => {
    installSinkhole({ 0: { resolve: { ok: true, status: 200 } } });
    const result = await postValidate({
      provider: "azure",
      apiKey: "az-key",
      providerSpecificData: { azureEndpoint: SINKHOLE, deployment: "gpt-4" },
    });
    expect(result.body).toEqual({ valid: true, error: null });
    expect(fetchCalls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(timeouts.map((t) => t.ms)).toContain(8000);
  });
});

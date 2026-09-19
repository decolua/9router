import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F24c / T1.1 M11 — the panel reset button sends the ACCOUNT key
 * (`provider:connectionId`) while real breakers are keyed per model
 * (`provider:connectionId:model`). The old route called
 * `resetCircuitBreaker(name)` on a key that never existed, the module helper
 * no-oped, and the route still answered `{ ok: true }` — a silent lie on the
 * only manual recovery path there was before the HALF_OPEN watchdog.
 *
 * Contract under test:
 *   i.   provider + connectionId (+ optional model) from body or query
 *   ii.  an account-level key sweeps EVERY `provider:connectionId:*` key
 *   iii. zero keys cleared is never reported as success → 404 { error }
 */

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status ?? 200, body })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

const cb = await import("../../open-sse/utils/circuitBreaker.js");
const { POST } = await import("../../src/app/api/providers/circuit-breakers/[name]/reset/route.js");

const ROUTE_BASE = "http://localhost/api/providers/circuit-breakers";
const PROVIDER = "f24c-prov";
const MODEL_A = "gpt-mini";
const MODEL_B = "gpt-big";

/**
 * The module registry is a singleton with no removal API, so breakers created
 * by one test stay registered (CLOSED) for the rest of the file. Every test
 * therefore gets its own connection id, and assertions can stay exact.
 */
let seq = 0;
const newConnectionId = () => `conn-${++seq}`;
const keyOf = (connectionId, model) => `${PROVIDER}:${connectionId}:${model}`;

const stateOf = (name) =>
  cb.getAllCircuitBreakerStatuses().find((b) => b.name === name)?.state;

/** Drive a breaker to OPEN through the module's own public API. */
function tripOpen(name) {
  cb.getCircuitBreaker(name, {
    failureThreshold: 2,
    resetTimeout: 1000,
    // cumulative mode: failures never decay out of the window, so the state
    // under test cannot drift while the assertions run.
    failureWindowMs: 0,
    halfOpenRequests: 1,
  });
  cb.recordFailure(name, { statusCode: 503 });
  cb.recordFailure(name, { statusCode: 500 });
  expect(stateOf(name)).toBe(cb.STATE.OPEN);
}

function makeReq({ url = `${ROUTE_BASE}/x/reset`, body } = {}) {
  return {
    url,
    json: async () => {
      if (body === undefined) throw new TypeError("Request has no JSON body");
      return body;
    },
  };
}

function ctxFor(name) {
  return { params: Promise.resolve(name === undefined ? {} : { name }) };
}

/** The panel's exact call shape (useCircuitBreakers.resetCircuitBreaker). */
function panelRequest(name) {
  return makeReq({ url: `${ROUTE_BASE}/${encodeURIComponent(name)}/reset` });
}

function resetPath(name) {
  return POST(panelRequest(name), ctxFor(name));
}

beforeEach(() => {
  vi.clearAllMocks();
  cb.resetAllCircuitBreakers();
});

afterEach(() => {
  cb.resetAllCircuitBreakers();
});

describe("POST /api/providers/circuit-breakers/[name]/reset", () => {
  it("clears every per-model breaker under the account key the panel sends", async () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    const kB = keyOf(conn, MODEL_B);
    tripOpen(kA);
    tripOpen(kB);

    const res = await resetPath(`${PROVIDER}:${conn}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect([...res.body.cleared].sort()).toEqual([kA, kB].sort());
    expect(res.body.count).toBe(2);
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
    expect(stateOf(kB)).toBe(cb.STATE.CLOSED);
    // The proof the sweep happened: a blocked breaker is passable again.
    expect(cb.isBlocked(kA)).toBe(false);
    expect(cb.isBlocked(kB)).toBe(false);
  });

  it("accepts provider + connectionId from the JSON body", async () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    const kB = keyOf(conn, MODEL_B);
    tripOpen(kA);
    tripOpen(kB);

    const res = await POST(
      makeReq({ url: `${ROUTE_BASE}/reset`, body: { provider: PROVIDER, connectionId: conn } }),
      ctxFor(undefined),
    );

    expect(res.status).toBe(200);
    expect([...res.body.cleared].sort()).toEqual([kA, kB].sort());
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
    expect(stateOf(kB)).toBe(cb.STATE.CLOSED);
  });

  it("accepts provider + connectionId from the query string", async () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    tripOpen(kA);

    const url = `${ROUTE_BASE}/reset?provider=${PROVIDER}&connectionId=${conn}`;
    const res = await POST(makeReq({ url }), ctxFor(undefined));

    expect(res.status).toBe(200);
    expect(res.body.cleared).toEqual([kA]);
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
  });

  it("scopes the sweep to a single model when model is provided", async () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    const kB = keyOf(conn, MODEL_B);
    tripOpen(kA);
    tripOpen(kB);

    const res = await POST(
      makeReq({
        url: `${ROUTE_BASE}/reset`,
        body: { provider: PROVIDER, connectionId: conn, model: MODEL_A },
      }),
      ctxFor(undefined),
    );

    expect(res.status).toBe(200);
    expect(res.body.cleared).toEqual([kA]);
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
    expect(stateOf(kB)).toBe(cb.STATE.OPEN);
  });

  it("resets an exact full key passed as the path name", async () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    const kB = keyOf(conn, MODEL_B);
    tripOpen(kA);
    tripOpen(kB);

    // The panel URL-encodes the key, so the param can arrive percent-encoded.
    const res = await POST(
      panelRequest(encodeURIComponent(kA)),
      ctxFor(encodeURIComponent(kA)),
    );

    expect(res.status).toBe(200);
    expect(res.body.cleared).toEqual([kA]);
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
    expect(stateOf(kB)).toBe(cb.STATE.OPEN);
  });

  it("does not sweep a sibling account whose id merely starts with the same text", async () => {
    const base = `sib${++seq}`;
    const kA = keyOf(base, MODEL_A);
    const kShadow = keyOf(`${base}0`, MODEL_A);
    tripOpen(kA);
    tripOpen(kShadow);

    const res = await resetPath(`${PROVIDER}:${base}`);

    expect(res.status).toBe(200);
    expect(res.body.cleared).toEqual([kA]);
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
    expect(stateOf(kShadow)).toBe(cb.STATE.OPEN);
  });

  it("answers 404 and never { ok: true } when nothing matched", async () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    tripOpen(kA);

    const res = await resetPath(`${PROVIDER}:no-such-conn-${conn}-x`);

    expect(res.status).toBe(404);
    expect(res.body.ok).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
    expect(res.body.cleared).toEqual([]);
    // Nothing was touched as a side effect of the failed reset.
    expect(stateOf(kA)).toBe(cb.STATE.OPEN);
  });

  it("answers 404 when the prefix stops inside a key segment", async () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    tripOpen(kA);

    // `provider:conn:gpt-mi` is a text prefix of the key but not a segment
    // boundary — matching it would let a typo'd model clear live breakers.
    const res = await resetPath(`${PROVIDER}:${conn}:gpt-mi`);

    expect(res.status).toBe(404);
    expect(res.body.ok).toBeUndefined();
    expect(stateOf(kA)).toBe(cb.STATE.OPEN);
  });

  it("answers 400 when neither a name nor provider + connectionId were supplied", async () => {
    const res = await POST(makeReq({ url: `${ROUTE_BASE}/reset` }), ctxFor(undefined));

    expect(res.status).toBe(400);
    expect(res.body.ok).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
  });

  it("answers 400 when provider is given without connectionId", async () => {
    const res = await POST(
      makeReq({ url: `${ROUTE_BASE}/reset`, body: { provider: PROVIDER } }),
      ctxFor(undefined),
    );

    expect(res.status).toBe(400);
    expect(res.body.ok).toBeUndefined();
    expect(typeof res.body.error).toBe("string");
  });

  it("answers 400 on a malformed percent-encoded name instead of throwing", async () => {
    const bad = "%E0%A4%A"; // decodes to an invalid UTF-8 sequence
    const res = await POST(panelRequest(bad), ctxFor(bad));

    expect(res.status).toBe(400);
    expect(res.body.ok).toBeUndefined();
  });
});

describe("resetCircuitBreakersByPrefix (additive module helper)", () => {
  it("exists and reports the keys it cleared", () => {
    expect(typeof cb.resetCircuitBreakersByPrefix).toBe("function");

    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    const kB = keyOf(conn, MODEL_B);
    tripOpen(kA);
    tripOpen(kB);

    expect([...cb.resetCircuitBreakersByPrefix(`${PROVIDER}:${conn}`)].sort()).toEqual([kA, kB].sort());
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
    expect(stateOf(kB)).toBe(cb.STATE.CLOSED);
  });

  it("is idempotent and leaves nothing open under the account", () => {
    const conn = newConnectionId();
    tripOpen(keyOf(conn, MODEL_A));
    tripOpen(keyOf(conn, MODEL_B));

    const first = cb.resetCircuitBreakersByPrefix(`${PROVIDER}:${conn}`);
    const second = cb.resetCircuitBreakersByPrefix(`${PROVIDER}:${conn}`);

    expect(second).toEqual(first);
    expect(cb.isBlocked(keyOf(conn, MODEL_A))).toBe(false);
    expect(cb.canExecute(keyOf(conn, MODEL_B))).toBe(true);
  });

  it("returns an empty list for an account with no breakers", () => {
    const conn = newConnectionId();

    expect(cb.resetCircuitBreakersByPrefix(`${PROVIDER}:${conn}`)).toEqual([]);
  });

  it("ignores empty prefixes rather than wiping the registry", () => {
    const conn = newConnectionId();
    tripOpen(keyOf(conn, MODEL_A));

    expect(cb.resetCircuitBreakersByPrefix("")).toEqual([]);
    expect(cb.resetCircuitBreakersByPrefix(null)).toEqual([]);
    expect(cb.resetCircuitBreakersByPrefix(undefined)).toEqual([]);
    expect(stateOf(keyOf(conn, MODEL_A))).toBe(cb.STATE.OPEN);
  });

  it("does not change what resetCircuitBreaker does (exact key only, existing contract)", () => {
    const conn = newConnectionId();
    const kA = keyOf(conn, MODEL_A);
    tripOpen(kA);

    cb.resetCircuitBreaker(`${PROVIDER}:${conn}`);
    expect(stateOf(kA)).toBe(cb.STATE.OPEN);

    cb.resetCircuitBreaker(kA);
    expect(stateOf(kA)).toBe(cb.STATE.CLOSED);
  });
});

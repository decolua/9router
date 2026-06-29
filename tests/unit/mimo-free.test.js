/**
 * Unit tests for the MiMo Free no-auth provider.
 *
 * Covers the parts that would silently break the bootstrap → JWT → chat flow:
 *   - fingerprint / session id primitives (format + determinism)
 *   - JWT bootstrap (caching, exp parsing, error paths)
 *   - system marker injection (the 403 anti-abuse gate)
 *   - executor wiring (headers, transformRequest, registration)
 *   - provider/model config registration
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock proxyAwareFetch so bootstrapJwt never hits the network.
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { MimoFreeExecutor, __test__ } from "../../open-sse/executors/mimo-free.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { FREE_PROVIDERS } from "../../src/shared/constants/providers.js";

const {
  generateFingerprint, generateSessionId, bootstrapJwt, resetJwtCache, parseJwtExp,
  injectSystemMarker, MIMO_SYSTEM_MARKER, SESSION_AFFINITY_PREFIX, BOOTSTRAP_URL, CHAT_URL,
} = __test__;

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

// Build a fake JWT with the given exp (seconds) in the payload.
function makeJwt(expSec) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
  return `${header}.${payload}.sig`;
}

beforeEach(() => {
  fetchMock.mockReset();
  resetJwtCache();
});

describe("generateSessionId", () => {
  it("uses the ses_ prefix and a 24-char random suffix", () => {
    const id = generateSessionId();
    expect(id.startsWith(SESSION_AFFINITY_PREFIX)).toBe(true);
    expect(id.length).toBe(SESSION_AFFINITY_PREFIX.length + 24);
  });

  it("only emits lowercase alphanumeric characters in the suffix", () => {
    expect(generateSessionId().slice(SESSION_AFFINITY_PREFIX.length)).toMatch(/^[a-z0-9]{24}$/);
  });

  it("produces a fresh id on each call", () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
  });
});

describe("generateFingerprint", () => {
  it("returns a 64-char hex sha256 digest", () => {
    expect(generateFingerprint()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable per machine (deterministic across calls)", () => {
    expect(generateFingerprint()).toBe(generateFingerprint());
  });
});

describe("parseJwtExp", () => {
  it("derives the expiry from the JWT exp claim (ms)", () => {
    const expSec = Math.floor(Date.now() / 1000) + 3600;
    expect(parseJwtExp(makeJwt(expSec))).toBe(expSec * 1000);
  });

  it("falls back to a future timestamp when the JWT is unparseable", () => {
    const before = Date.now();
    const result = parseJwtExp("not-a-jwt");
    expect(result).toBeGreaterThan(before);
  });
});

describe("injectSystemMarker", () => {
  it("prepends a system message with the marker when none is present", () => {
    const out = injectSystemMarker({ messages: [{ role: "user", content: "hi" }] });
    expect(out.messages[0].role).toBe("system");
    expect(out.messages[0].content).toContain(MIMO_SYSTEM_MARKER);
  });

  it("preserves the original user message after injection", () => {
    const out = injectSystemMarker({ messages: [{ role: "user", content: "write a haiku" }] });
    expect(out.messages.find((m) => m.role === "user").content).toBe("write a haiku");
  });

  it("keeps a caller-provided system prompt alongside the marker", () => {
    const out = injectSystemMarker({
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "hi" },
      ],
    });
    const sys = out.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    expect(sys).toContain(MIMO_SYSTEM_MARKER);
    expect(sys).toContain("You are a pirate.");
  });

  it("does not duplicate the marker when already present", () => {
    const out = injectSystemMarker({
      messages: [
        { role: "system", content: `${MIMO_SYSTEM_MARKER}\nExtra.` },
        { role: "user", content: "hi" },
      ],
    });
    const count = out.messages.filter(
      (m) => m.role === "system" && m.content.includes(MIMO_SYSTEM_MARKER)
    ).length;
    expect(count).toBe(1);
  });

  it("leaves a body without a messages array untouched", () => {
    const body = { prompt: "legacy" };
    expect(injectSystemMarker(body)).toBe(body);
  });
});

describe("bootstrapJwt", () => {
  it("returns the jwt from the bootstrap response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) }));
    const jwt = await bootstrapJwt();
    expect(jwt).toMatch(/\./);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(BOOTSTRAP_URL);
  });

  it("sends the machine fingerprint as the bootstrap client", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) }));
    await bootstrapJwt();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client).toBe(generateFingerprint());
  });

  it("caches the jwt and does not re-fetch while still valid", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) }));
    const first = await bootstrapJwt();
    const second = await bootstrapJwt();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cached jwt is within the expiry buffer", async () => {
    // exp 100s out < 300s buffer → treated as near-expiry.
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 100) }));
    await bootstrapJwt();
    const fresh = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: fresh }));
    expect(await bootstrapJwt()).toBe(fresh);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the bootstrap response is not ok", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 403 }));
    await expect(bootstrapJwt()).rejects.toThrow(/bootstrap failed: 403/);
  });

  it("throws when the bootstrap response has no jwt", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ expiresIn: 3600 }));
    await expect(bootstrapJwt()).rejects.toThrow(/no JWT/);
  });
});

describe("MimoFreeExecutor", () => {
  const exec = new MimoFreeExecutor();

  it("buildUrl returns the free-ai chat endpoint", () => {
    expect(exec.buildUrl()).toBe(CHAT_URL);
  });

  it("buildHeaders includes the MiMo source and session affinity", () => {
    const h = exec.buildHeaders({}, true);
    expect(h["X-Mimo-Source"]).toBe("mimocode-cli-free");
    expect(h["x-session-affinity"]).toMatch(/^ses_/);
    expect(h["Accept"]).toBe("text/event-stream");
  });

  it("transformRequest injects the system marker", () => {
    const out = exec.transformRequest("mimo-auto", { messages: [{ role: "user", content: "hi" }] });
    expect(out.messages[0].content).toContain(MIMO_SYSTEM_MARKER);
  });

  it("execute injects the marker and sends a Bearer JWT to the chat endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const { url, headers, transformedBody } = await exec.execute({
      model: "mimo-auto",
      body: { model: "mimo-auto", stream: true, messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: {},
    });
    expect(url).toBe(CHAT_URL);
    expect(headers["Authorization"]).toMatch(/^Bearer /);
    expect(transformedBody.messages[0].content).toContain(MIMO_SYSTEM_MARKER);
    // first call = bootstrap, second = chat with auth header
    const chatHeaders = fetchMock.mock.calls[1][1].headers;
    expect(chatHeaders["Authorization"]).toMatch(/^Bearer /);
  });

  it("re-bootstraps and retries once on a 403 from the chat endpoint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) }));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    fetchMock.mockResolvedValueOnce(jsonResponse({ jwt: makeJwt(Math.floor(Date.now() / 1000) + 3600) }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const { response } = await exec.execute({
      model: "mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: {},
    });
    expect(response.status).toBe(200);
    // bootstrap, chat(403), re-bootstrap, chat(200)
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("MiMo Free provider registration", () => {
  it("registers a specialized executor for mimo-free and the mmf alias", () => {
    expect(getExecutor("mimo-free")).toBeInstanceOf(MimoFreeExecutor);
    expect(getExecutor("mmf")).toBeInstanceOf(MimoFreeExecutor);
  });

  it("registers mimo-free as a no-auth provider in open-sse config", () => {
    expect(PROVIDERS["mimo-free"]?.noAuth).toBe(true);
    expect(PROVIDERS.mmf?.noAuth).toBe(true);
  });

  it("exposes only mimo-auto (the sole free-channel model)", () => {
    expect(PROVIDER_MODELS.mmf.map((m) => m.id)).toEqual(["mimo-auto"]);
  });

  it("maps the mimo-free alias to mmf", () => {
    expect(PROVIDER_ID_TO_ALIAS["mimo-free"]).toBe("mmf");
  });

  it("lists mimo-free in the dashboard FREE_PROVIDERS catalog", () => {
    expect(FREE_PROVIDERS["mimo-free"]?.alias).toBe("mmf");
    expect(FREE_PROVIDERS["mimo-free"]?.noAuth).toBe(true);
  });
});

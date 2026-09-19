// F10 — /v1 non-chat surface fixes (findings T1.8 V2/V6/V7):
// (a) /v1/audio/voices self-fetches /api/media-providers/* which is deny-by-default
//     under dashboardGuard requireLogin=true → must carry internal credentials and
//     must target the internal loopback origin, never the request's Host header.
// (b) /v1/models/info must publish the real webFetch endpoint "/v1/web/fetch".
// (c) /v1/responses/compact must answer 400 (OpenAI-shaped) for malformed JSON, not 500.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  handleChat: vi.fn(),
  initTranslators: vi.fn(),
}));

// Internal-credential sources used by the voices route (same pattern as
// src/app/api/providers/[id]/test-models/route.js:13-22).
vi.mock("@/lib/localDb", () => ({ getApiKeys: mocks.getApiKeys }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
// Keep the compact route test off the real chat pipeline / translator registry.
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: mocks.initTranslators }));

const { GET: voicesGET } = await import("../../src/app/api/v1/audio/voices/route.js");
const { GET: infoGET } = await import("../../src/app/api/v1/models/info/route.js");
const { POST: compactPOST } = await import("../../src/app/api/v1/responses/compact/route.js");

const originalFetch = global.fetch;

// Simulates dashboardGuard on /api/media-providers/* with requireLogin=true:
// a self-fetch without internal credentials gets 401, exactly like production.
function guardLikeMediaApi() {
  return vi.fn(async (url, init = {}) => {
    const headers = new Headers((init && init.headers) || {});
    if (!headers.get("authorization") || !headers.get("x-9r-cli-token")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({
      object: "list",
      voices: [{ id: "voice-1", name: "Ana", lang: "pt", gender: "female" }],
    });
  });
}

describe("GET /v1/audio/voices internal self-fetch (T1.8 V2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("carries Authorization + x-9r-cli-token so the credential-less 401 loop disappears", async () => {
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-active-key", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token-value");
    global.fetch = guardLikeMediaApi();

    const res = await voicesGET(
      new Request("https://router.test/v1/audio/voices?provider=elevenlabs&lang=pt"),
    );

    // RED today: route fetches without headers → guard mock 401s → route proxies 401.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { id: "voice-1", name: "Ana", lang: "pt", gender: "female", model: "el/voice-1" },
    ]);

    const [, init] = global.fetch.mock.calls[0];
    const headers = new Headers((init && init.headers) || {});
    expect(headers.get("authorization")).toBe("Bearer sk-active-key");
    expect(headers.get("x-9r-cli-token")).toBe("cli-token-value");
    expect(mocks.getConsistentMachineId).toHaveBeenCalledWith("9r-cli-auth");
  });

  it("builds the self-fetch URL against the internal loopback port, never the request Host", async () => {
    const savedPort = process.env.PORT;
    process.env.PORT = "20999";
    try {
      global.fetch = vi.fn(async () => Response.json({ object: "list", voices: [] }));

      await voicesGET(
        new Request("https://evil.example:9999/v1/audio/voices?provider=elevenlabs&lang=pt"),
      );

      // RED today: origin comes from request.url (Host header) → evil.example:9999.
      const [url] = global.fetch.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:20999/api/media-providers/tts/elevenlabs/voices?lang=pt");
      expect(url).not.toContain("evil.example");
    } finally {
      process.env.PORT = savedPort;
    }
  });
});

describe("GET /v1/models/info published endpoints (T1.8 V7)", () => {
  it("webFetch kind points at the existing /v1/web/fetch route", async () => {
    const res = await infoGET(new Request("http://router.test/v1/models/info?id=tavily/fetch"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("webFetch");
    // RED today: "/v1/fetch" — no such route or rewrite; real one is /v1/web/fetch.
    expect(body.endpoint).toBe("/v1/web/fetch");
    expect(body.endpoint).not.toBe("/v1/fetch");
  });
});

describe("POST /v1/responses/compact body parsing (T1.8 V6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initTranslators.mockResolvedValue(undefined);
  });

  it("returns a 400 invalid_request_error for a malformed JSON body instead of throwing 500", async () => {
    const res = await compactPOST(
      new Request("http://router.test/v1/responses/compact", {
        method: "POST",
        body: "{not-json",
      }),
    );

    // RED today: request.json() throws uncaught → rejected promise (500 in the app).
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatchObject({
      message: "Invalid JSON body",
      type: "invalid_request_error",
    });
    expect(mocks.handleChat).not.toHaveBeenCalled();
  });

  it("still delegates well-formed bodies to handleChat with the _compact flag", async () => {
    mocks.handleChat.mockImplementation(async (req) =>
      Response.json({ seen: await req.json() }),
    );

    const res = await compactPOST(
      new Request("http://router.test/v1/responses/compact", {
        method: "POST",
        body: JSON.stringify({ model: "x/y", input: "hi" }),
      }),
    );

    const body = await res.json();
    expect(body.seen).toMatchObject({ model: "x/y", _compact: true });
    expect(mocks.handleChat).toHaveBeenCalledTimes(1);
  });
});

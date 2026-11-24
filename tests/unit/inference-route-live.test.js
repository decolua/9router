import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readRequestKey: vi.fn(),
  saveRequestUsage: vi.fn(),
}));

vi.mock("../../src/sse/services/requestKey.js", () => ({ readRequestKey: mocks.readRequestKey }));
vi.mock("open-sse/services/inferenceError.js", () => ({ classifyInferenceError: vi.fn(() => ({ category: "unknown" })) }));
vi.mock("../../src/lib/db/repos/usageRepo.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));

const { inferenceRoute } = await import("../../src/lib/observability/inferenceRoute.js");
const { usageTrace } = await import("../../src/lib/observability/requestContext.js");
const { getLiveRoutesSnapshot, resetLiveRoutes } = await import("../../src/lib/observability/liveRoutes.js");

function request(path = "/v1/chat/completions", signal) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "user-agent": "curl/8.5.0" },
    signal,
  });
}

describe("inferenceRoute live route integration", () => {
  beforeEach(() => {
    resetLiveRoutes();
    mocks.readRequestKey.mockReset();
    mocks.saveRequestUsage.mockReset().mockImplementation(async entry => usageTrace(entry));
  });

  it("closes non-streaming requests", async () => {
    const route = inferenceRoute(async () => Response.json({ ok: true }));
    const response = await route(request());
    expect(response.ok).toBe(true);
    expect(getLiveRoutesSnapshot()[0].status).toBe("ok");
  });

  it("closes streamed requests when the client cancels", async () => {
    const controller = new AbortController();
    const route = inferenceRoute(async () => new Response(new ReadableStream({
      start(stream) { stream.enqueue(new TextEncoder().encode("data: chunk\n\n")); },
      cancel() {},
    }), { headers: { "content-type": "text/event-stream" } }));
    const response = await route(request("/v1/chat/completions", controller.signal));
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel("client disconnected");
    expect(getLiveRoutesSnapshot()[0].status).toBe("error");
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: vi.fn() }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => {}) }));

const { parseUpstreamError, buildErrorBody, isContextOverflowError } = await import("../../open-sse/utils/error.js");
const { handleChat } = await import("@/sse/handlers/chat.js");
const { POST } = await import("../../src/app/api/v1/responses/route.js");

const COPILOT_BODY = JSON.stringify({ error: { message: "Your input exceeds the context window of this model. Please adjust your input and try again.", code: "invalid_request_body" } });

const req = (body) => new Request("http://localhost/v1/responses", { method: "POST", body: JSON.stringify(body) });
const overflow400 = () => new Response(JSON.stringify(buildErrorBody(400, "[400]: too long", "context_length_exceeded")), { status: 400, headers: { "Content-Type": "application/json" } });

describe("context overflow error semantics (#5278)", () => {
  it("parseUpstreamError keeps the upstream error code", async () => {
    const r = await parseUpstreamError(new Response(JSON.stringify({ error: { message: "x", code: "context_length_exceeded" } }), { status: 400 }));
    expect(r.code).toBe("context_length_exceeded");
  });

  it("classifies the Copilot overflow wording, not every invalid_request_body", () => {
    expect(isContextOverflowError(400, "invalid_request_body", JSON.parse(COPILOT_BODY).error.message)).toBe(true);
    expect(isContextOverflowError(400, "context_length_exceeded", "")).toBe(true);
    expect(isContextOverflowError(400, "invalid_request_body", "Unsupported parameter: foo")).toBe(false);
    expect(isContextOverflowError(429, null, "exceeds the context window")).toBe(false);
  });

  it("buildErrorBody uses the given code instead of bad_request", () => {
    expect(buildErrorBody(400, "m", "context_length_exceeded").error.code).toBe("context_length_exceeded");
    expect(buildErrorBody(400, "m").error.code).toBe("bad_request");
  });

  it("streaming Responses client gets a response.failed event Codex recognises", async () => {
    handleChat.mockResolvedValueOnce(overflow400());
    const res = await POST(req({ model: "gh/gpt-5", stream: true, input: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: response.failed");
    const data = JSON.parse(text.split("\n").find((l) => l.startsWith("data: {")).slice(6));
    expect(data.response.status).toBe("failed");
    expect(data.response.error.code).toBe("context_length_exceeded");
  });

  it("non-streaming Responses client keeps HTTP 400", async () => {
    handleChat.mockResolvedValueOnce(overflow400());
    const res = await POST(req({ model: "gh/gpt-5", input: "hi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("context_length_exceeded");
  });

  it("a 413 overflow is re-framed the same way", async () => {
    handleChat.mockResolvedValueOnce(new Response(JSON.stringify(buildErrorBody(413, "too long", "context_length_exceeded")), { status: 413, headers: { "Content-Type": "application/json" } }));
    const res = await POST(req({ model: "cx/gpt-5", stream: true, input: "hi" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"code":"context_length_exceeded"');
  });

  it("unrelated 400 on a streaming client is passed through untouched", async () => {
    handleChat.mockResolvedValueOnce(new Response(JSON.stringify(buildErrorBody(400, "bad")), { status: 400, headers: { "Content-Type": "application/json" } }));
    const res = await POST(req({ model: "gh/gpt-5", stream: true, input: "hi" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });
});

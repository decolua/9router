import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDeferredResponsesResponseMock, handleChatMock, initTranslatorsMock } = vi.hoisted(() => ({
  createDeferredResponsesResponseMock: vi.fn(),
  handleChatMock: vi.fn(),
  initTranslatorsMock: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: handleChatMock }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: initTranslatorsMock }));
vi.mock("open-sse/utils/responsesStreamBridge.js", () => ({
  createDeferredResponsesResponse: createDeferredResponsesResponseMock,
}));

import { POST } from "../../src/app/api/v1/responses/route.js";

describe("Responses route streaming selection", () => {
  beforeEach(() => {
    createDeferredResponsesResponseMock.mockReset();
    createDeferredResponsesResponseMock.mockReturnValue(new Response(null, { status: 200 }));
    handleChatMock.mockReset();
    handleChatMock.mockResolvedValue(new Response(JSON.stringify({ id: "resp_test" }), {
      headers: { "Content-Type": "application/json" },
    }));
  });

  it("keeps omitted stream non-streaming", async () => {
    const body = { model: "gpt-5.6-sol", input: "hello" };
    const request = new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const response = await POST(request);

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ id: "resp_test" });
    expect(handleChatMock).toHaveBeenCalledWith(request, null, { body });
  });

  it("enables event keepalives for Codex streams", async () => {
    const body = { model: "gpt-5.6-sol", input: "hello", stream: true };
    const request = new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "codex_cli_rs/0.113.0",
      },
      body: JSON.stringify(body),
    });

    await POST(request);

    expect(createDeferredResponsesResponseMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ eventKeepalive: true }),
    );
  });
});

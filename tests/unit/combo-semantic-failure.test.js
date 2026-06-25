import { afterEach, describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

function okResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errResponse(message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("combo fallback on semantic upstream failure", () => {
  it("falls through to the next model after a retryable 503 capacity error", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn) => {
      if (typeof fn === "function") fn();
      return 0;
    });

    const handleSingleModel = vi.fn(async (_body, modelStr) => {
      if (modelStr === "cx/gpt-5.4") {
        return errResponse("Selected model is at capacity. Please try a different model.");
      }
      return okResponse("fallback ok");
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hello" }] },
      models: ["cx/gpt-5.4", "cx/gpt-5.5"],
      handleSingleModel,
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      comboStrategy: "fallback",
    });

    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(handleSingleModel.mock.calls[0][1]).toBe("cx/gpt-5.4");
    expect(handleSingleModel.mock.calls[1][1]).toBe("cx/gpt-5.5");
    expect(res.ok).toBe(true);
    expect(await res.json()).toMatchObject({
      choices: [{ message: { content: "fallback ok" } }],
    });
  });
});

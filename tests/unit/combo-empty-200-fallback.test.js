import { describe, it, expect } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

// isBodyEmpty is module-private, tested indirectly through handleComboChat

const fakeLog = { info: () => {}, warn: () => {}, error: () => {} };

function okResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VALID_BODY = { choices: [{ message: { content: "hello" } }] };

describe("combo empty 200 response handling", () => {
  it("returns immediately when first model returns valid body", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/model-1", "a/model-2"],
      handleSingleModel: async () => {
        calls++;
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-valid",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("hello");
    expect(calls).toBe(1);
  });

  it("retries same model once when first attempt returns empty object", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/model-1"],
      handleSingleModel: async () => {
        calls++;
        if (calls === 1) return okResponse({});
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-obj",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("hello");
    expect(calls).toBe(2); // first empty, retry succeeded
  });

  it("retries same model once when first attempt returns empty choices array", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/model-1"],
      handleSingleModel: async () => {
        calls++;
        if (calls === 1) return okResponse({ choices: [] });
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-choices",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("falls back to next model when retry also returns empty", async () => {
    const callLog = [];
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/flaky", "a/stable"],
      handleSingleModel: async (body, model) => {
        callLog.push(model);
        if (model === "a/flaky") return okResponse({}); // always empty
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-fallback",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("hello");
    // "a/flaky" called twice (initial + retry), then "a/stable" once
    expect(callLog).toEqual(["a/flaky", "a/flaky", "a/stable"]);
  });

  it("does not pollute lastError when all models return empty", async () => {
    // When all models return empty, the final error should NOT be the
    // empty body warning — it should stay "All combo models unavailable"
    const thatLog = { info: () => {}, warn: () => {}, error: () => {} };
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-1", "a/empty-2"],
      handleSingleModel: async () => okResponse({}),
      log: thatLog,
      comboName: "combo-all-empty",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    const json = await result.json();
    // Error message should be generic, not "returned 200 but empty body"
    expect(json.error.message).toBe("All combo models unavailable");
  });

  it("handles empty string body (not JSON)", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-str", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/empty-str") return new Response("", { status: 200 });
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-str",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("hello");
    expect(calls).toBeGreaterThanOrEqual(3); // empty-str x2 + stable
  });

  it("handles choices with empty message content", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-msg", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/empty-msg") {
          return okResponse({ choices: [{ message: { content: "" } }] });
        }
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-content",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    const json = await result.json();
    expect(json.choices[0].message.content).toBe("hello");
  });

  it("handles choices with empty message object", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-msg-obj", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/empty-msg-obj") {
          return okResponse({ choices: [{ message: {} }] });
        }
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-msg-obj",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("handles empty array body", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/empty-arr", "a/stable"],
      handleSingleModel: async (body, model) => {
        calls++;
        if (model === "a/empty-arr") return okResponse([]);
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-empty-arr",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
  });

  it("retry succeeds when model recovers on second attempt", async () => {
    let calls = 0;
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/recovers"],
      handleSingleModel: async () => {
        calls++;
        if (calls === 1) return okResponse({ choices: [{ delta: {}, finish_reason: null }] });
        return okResponse(VALID_BODY);
      },
      log: fakeLog,
      comboName: "combo-recovers",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("does not retry streaming responses (text() throws, treated as valid)", async () => {
    // Streaming Response throws when .text() is called on a locked body.
    // isBodyEmpty catches and returns false — no retry.
    let calls = 0;
    // Use a ReadableStream body that can be consumed to simulate streaming
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const result = await handleComboChat({
      body: { messages: [] },
      models: ["a/streaming"],
      handleSingleModel: async () => {
        calls++;
        return new Response(streamBody, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
      log: fakeLog,
      comboName: "combo-streaming",
      comboStrategy: "fallback",
    });

    expect(result.ok).toBe(true);
    // Streaming body consumed once by .clone().text() internally,
    // then returned — only 1 call, no retry triggered.
    expect(calls).toBe(1);
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  parseCommandCodeError,
  inspectAndWrapCommandCodeResponse,
  CommandCodeExecutor,
} from "../../open-sse/executors/commandcode.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

function createNdjsonStream(lines) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(typeof line === "string" ? line : JSON.stringify(line) + "\n"));
      }
      controller.close();
    },
  });
}

describe("parseCommandCodeError", () => {
  it("parses user exact error payload with statusCode 503 and isRetryable", () => {
    const event = {
      type: "error",
      error: {
        type: "server_error",
        message: "Service temporarily unavailable. Please try again shortly.",
        statusCode: 503,
        isRetryable: true,
      },
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(503);
    expect(parsed.message).toBe("Service temporarily unavailable. Please try again shortly.");
    expect(parsed.type).toBe("server_error");
  });

  it("handles string error message", () => {
    const event = {
      type: "error",
      message: "Rate limit exceeded. Please wait 30s.",
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.message).toBe("Rate limit exceeded. Please wait 30s.");
  });

  it("handles plain error string in error property", () => {
    const event = {
      type: "error",
      error: "Unauthorized access",
    };
    const parsed = parseCommandCodeError(event);
    expect(parsed.statusCode).toBe(401);
    expect(parsed.message).toBe("Unauthorized access");
  });
});

describe("inspectAndWrapCommandCodeResponse", () => {
  it("converts initial upstream 200 with error event to 503 Response", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({
        type: "error",
        error: {
          type: "server_error",
          message: "Service temporarily unavailable. Please try again shortly.",
          statusCode: 503,
          isRetryable: true,
        },
      }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);

    const body = await result.json();
    expect(body.error.message).toContain("Service temporarily unavailable");
    expect(body.error.code).toBe(503);
  });

  it("converts initial upstream 200 with start/start-step followed by error to 503 Response", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "start-step" }) + "\n",
      JSON.stringify({
        type: "error",
        error: {
          type: "server_error",
          message: "Service temporarily unavailable. Please try again shortly.",
          statusCode: 503,
          isRetryable: true,
        },
      }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);

    const body = await result.json();
    expect(body.error.message).toContain("Service temporarily unavailable");
  });

  it("streams successful responses when content is emitted", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "text-delta", text: "Hello from Laguna" }) + "\n",
      JSON.stringify({ type: "finish" }) + "\n",
    ]);

    const fakeResponse = new Response(ndjsonBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    const text = await result.text();
    expect(text).toContain("Hello from Laguna");
    expect(text).toContain("data: [DONE]");
  });

  it("keeps finish-step/finish that share a chunk with an earlier trigger", async () => {
    // Upstream can deliver a whole trailing run of events in one network chunk.
    // The peek loop must not drop the lines that follow the first trigger,
    // otherwise downstream never sees finish_reason.
    const events = [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start" },
      { type: "text-delta", text: "A" },
      { type: "text-delta", text: "B" },
      { type: "text-end" },
      { type: "finish-step", finishReason: "stop" },
      { type: "finish" },
    ];
    const singleChunk = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(events.map((e) => JSON.stringify(e)).join("\n") + "\n"));
        controller.close();
      },
    });

    const fakeResponse = new Response(singleChunk, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "poolside/laguna-s-2.1-free");
    expect(result.ok).toBe(true);

    const text = await result.text();
    const chunks = text
      .split("\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
      .map((l) => JSON.parse(l.slice(6)));

    const content = chunks.map((c) => c.choices?.[0]?.delta?.content).filter(Boolean).join("");
    expect(content).toBe("AB");
    expect(chunks.some((c) => c.choices?.[0]?.finish_reason === "stop")).toBe(true);
  });
});

// An upstream connection that resets during the peek loop used to make this function
// throw "Body is unusable: Body has already been read": the old fallback returned the
// original Response, whose body the reader had already disturbed. It also threw away
// every line buffered so far.
describe("inspectAndWrapCommandCodeResponse: upstream reset during the peek", () => {
  const encoder = new TextEncoder();

  // Emits `chunks`, then fails the way a reset upstream connection does.
  function resettingBody(chunks) {
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
        else controller.error(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
      },
    });
  }

  // None of these lines are peek triggers, so the reset lands inside the peek loop.
  const resetDuringPeek = (chunks) => inspectAndWrapCommandCodeResponse(
    new Response(resettingBody(chunks), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    "poolside/laguna-s-2.1-free",
  );

  it("does not throw when the reset lands before any line", async () => {
    const result = await resetDuringPeek([]);
    expect(result.ok).toBe(true);
    await expect(result.text()).resolves.toContain("data: [DONE]");
  });

  it("does not throw when the reset lands mid-line", async () => {
    const result = await resetDuringPeek(['{"type":"text-delta","te']);
    expect(result.ok).toBe(true);
    await expect(result.text()).resolves.toContain("data: [DONE]");
  });

  it("still replays the lines buffered before the reset", async () => {
    const result = await resetDuringPeek([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "start-step" }) + "\n",
    ]);
    expect(result.ok).toBe(true);
    const text = await result.text();
    expect(text).toContain("data: ");
    expect(text).toContain("data: [DONE]");
  });
});

describe("CommandCode in Combo Fallback", () => {
  it("automatically falls back to next model when commandcode returns 503 error", async () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const handleSingleModel = vi.fn(async (body, modelStr) => {
      if (modelStr === "commandcode/poolside/laguna-s-2.1-free") {
        // Simulated failed CommandCode response
        return new Response(
          JSON.stringify({
            error: {
              message: "Service temporarily unavailable. Please try again shortly.",
              type: "server_error",
              code: 503,
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }

      if (modelStr === "openai/gpt-4o-mini") {
        // Fallback model succeeds
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            choices: [{ message: { role: "assistant", content: "Fallback success!" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("Not found", { status: 404 });
    });

    const comboResponse = await handleComboChat({
      body: { messages: [{ role: "user", content: "Hello" }] },
      models: ["commandcode/poolside/laguna-s-2.1-free", "openai/gpt-4o-mini"],
      handleSingleModel,
      log,
      comboName: "test-combo",
      comboStrategy: "fallback",
    });

    expect(comboResponse.ok).toBe(true);
    expect(comboResponse.status).toBe(200);

    const data = await comboResponse.json();
    expect(data.choices[0].message.content).toBe("Fallback success!");
    expect(handleSingleModel).toHaveBeenCalledTimes(2);
    expect(handleSingleModel).toHaveBeenNthCalledWith(1, expect.anything(), "commandcode/poolside/laguna-s-2.1-free");
    expect(handleSingleModel).toHaveBeenNthCalledWith(2, expect.anything(), "openai/gpt-4o-mini");
  });
});

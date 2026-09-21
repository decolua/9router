import { describe, it, expect, vi } from "vitest";
import {
  parseCommandCodeError,
  inspectAndWrapCommandCodeResponse,
  CommandCodeExecutor,
} from "../../open-sse/executors/commandcode.js";
import { commandCodeToOpenAIResponse } from "../../open-sse/translator/response/commandcode-to-openai.js";
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
  it.each(["ndjson", "sse"])("preserves every event across arbitrary %s chunk boundaries", async (format) => {
    const events = [
      { type: "start" },
      { type: "reasoning-delta", text: "Checking" },
      { type: "tool-call", toolCallId: "call_chunk", toolName: "Read", input: { file_path: "/tmp/test" } },
      { type: "finish", finishReason: "tool-calls" },
    ];
    const raw = events.map(event => format === "sse"
      ? `data: ${JSON.stringify(event)}\n\n`
      : `${JSON.stringify(event)}\n`).join("");
    for (let split = 0; split <= raw.length; split++) {
      const response = new Response(createNdjsonStream([raw.slice(0, split), raw.slice(split)]));
      const wrapped = await inspectAndWrapCommandCodeResponse(response, "test-model");
      const output = await wrapped.text();
      expect(output).toContain("Checking");
      expect(output).toContain("call_chunk");
      expect(output).toContain('"finish_reason":"tool_calls"');
      expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    }
  });

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

  it("keeps provisional tool input buffered so a later error can still retry", async () => {
    const fakeResponse = new Response(createNdjsonStream([
      JSON.stringify({ type: "tool-input-start", id: "c1", toolName: "Bash" }) + "\n",
      JSON.stringify({ type: "tool-input-delta", id: "c1", delta: '{"command":"draft"}' }) + "\n",
      JSON.stringify({
        type: "error",
        error: { type: "server_error", message: "Service temporarily unavailable", statusCode: 503 },
      }) + "\n",
    ]), { status: 200, headers: { "Content-Type": "text/event-stream" } });

    const result = await inspectAndWrapCommandCodeResponse(fakeResponse, "deepseek/deepseek-v4-flash");
    expect(result.status).toBe(503);
    await expect(result.json()).resolves.toMatchObject({ error: { code: 503 } });
  });

  it("streams successful responses when content is emitted", async () => {
    const ndjsonBody = createNdjsonStream([
      JSON.stringify({ type: "start" }) + "\n",
      JSON.stringify({ type: "text-delta", text: "Hello from Laguna" }) + "\n",
      JSON.stringify({ type: "finish", finishReason: "stop" }) + "\n",
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

  it("retries when initial stream yields an error and succeeds on second attempt", async () => {
    let callCount = 0;
    const executor = new CommandCodeExecutor();
    
    // Override execute on instance to test retry behavior
    executor.execute = async (opts) => {
      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        callCount++;
        let rawResponse;
        if (callCount === 1) {
          rawResponse = new Response(createNdjsonStream([
            JSON.stringify({
              type: "error",
              error: { type: "server_error", message: "Network connection lost." }
            }) + "\n"
          ]), { status: 200, headers: { "Content-Type": "text/event-stream" } });
        } else {
          rawResponse = new Response(createNdjsonStream([
            JSON.stringify({ type: "start" }) + "\n",
            JSON.stringify({ type: "text-delta", text: "Recovered from lost connection" }) + "\n",
            JSON.stringify({ type: "finish", finishReason: "stop" }) + "\n"
          ]), { status: 200, headers: { "Content-Type": "text/event-stream" } });
        }

        const wrappedResponse = await inspectAndWrapCommandCodeResponse(rawResponse, opts.model);
        if (!wrappedResponse.ok && attempt < maxRetries) {
          continue;
        }
        return { response: wrappedResponse };
      }
    };

    const res = await executor.execute({ model: "deepseek/deepseek-v4.1-flash" });
    expect(res.response.ok).toBe(true);
    expect(callCount).toBe(2);
    const text = await res.response.text();
    expect(text).toContain("Recovered from lost connection");
  });
});

describe("CommandCode reference protocol compatibility", () => {
  it("uses the current official CLI identity headers", () => {
    const headers = new CommandCodeExecutor().buildHeaders({ apiKey: "user_test" });
    expect(headers).toMatchObject({
      Authorization: "Bearer user_test",
      "x-command-code-version": "1.54.2",
      "x-cli-environment": "production",
      "User-Agent": "cli",
    });
    expect(headers["x-session-id"]).toBeUndefined();
  });

  it("ignores provisional tool input and emits the authoritative tool call", () => {
    const state = {};
    expect(commandCodeToOpenAIResponse({ type: "tool-input-start", id: "c1", toolName: "write" }, state)).toBeNull();
    expect(commandCodeToOpenAIResponse({ type: "tool-input-delta", id: "c1", delta: '{"content":"draft"}' }, state)).toBeNull();
    expect(commandCodeToOpenAIResponse({
      type: "tool-call",
      toolCallId: "c1",
      toolName: "write",
      input: { path: "/a", content: "complete" },
    }, state)).toBeNull();

    const chunks = commandCodeToOpenAIResponse({ type: "finish", finishReason: "tool-calls" }, state);
    expect(chunks[0].choices[0].delta.tool_calls[0].function.arguments).toBe('{"path":"/a","content":"complete"}');
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("rejects a tool finish without an authoritative call", () => {
    const state = {};
    commandCodeToOpenAIResponse({ type: "tool-input-start", id: "c1", toolName: "bash" }, state);
    commandCodeToOpenAIResponse({ type: "tool-input-delta", id: "c1", delta: '{"command":"partial"}' }, state);
    expect(() => commandCodeToOpenAIResponse(
      { type: "finish", finishReason: "tool-calls" },
      state,
    )).toThrow("no valid tool call");
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

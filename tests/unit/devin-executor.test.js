import { describe, expect, it, vi } from "vitest";
import { getExecutor } from "open-sse/executors/index.js";
import {
  DevinExecutor,
  frameDevinConnect,
} from "open-sse/executors/devin.js";

function stringField(field, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from([field << 3 | 2, bytes.length]), bytes]);
}

function messageField(field, payload) {
  return Buffer.concat([Buffer.from([field << 3 | 2, payload.length]), payload]);
}

describe("Devin executor", () => {
  it("is registered as a specialized executor", () => {
    expect(getExecutor("devin")).toBeInstanceOf(DevinExecutor);
  });

  it("calls GetUserJwt before streaming GetChatMessage", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("GetUserJwt")) {
        return new Response(stringField(1, "jwt"), { status: 200 });
      }
      const text = stringField(3, "hello");
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(frameDevinConnect(text));
          controller.enqueue(frameDevinConnect(Buffer.from([0x28, 0x00])));
          controller.close();
        },
      }), { status: 200 });
    });

    const result = await new DevinExecutor().execute({
      fetchImpl: global.fetch,
      model: "swe-1-7",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "session-token" },
      signal: undefined,
    });
    const output = await result.response.text();

    expect(calls.map((call) => call.url)).toEqual([
      expect.stringContaining("GetUserJwt"),
      expect.stringContaining("GetChatMessage"),
    ]);
    expect(calls[1].init.headers["content-type"]).toBe("application/connect+proto");
    expect(output).toContain("hello");
    expect(output).toContain('"finish_reason":"stop"');
    expect(output).toContain("[DONE]");
  });

  it("maps tool calls and usage into the SSE stream", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "jwt"), { status: 200 });
      const tool = Buffer.concat([stringField(1, "call-1"), stringField(2, "run"), stringField(3, "{\"x\":1}")]);
      const usage = Buffer.from([0x10, 0x0a, 0x18, 0x14, 0x20, 0x02, 0x28, 0x01]);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(frameDevinConnect(messageField(6, tool)));
          controller.enqueue(frameDevinConnect(messageField(7, usage)));
          controller.close();
        },
      }), { status: 200 });
    });

    const result = await new DevinExecutor().execute({
      fetchImpl: global.fetch,
      model: "swe-1-7",
      body: { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "run", parameters: {} } }] },
      stream: true,
      credentials: { accessToken: "token" },
    });
    const output = await result.response.text();

    expect(output).toContain('"tool_calls"');
    expect(output).toContain('"prompt_tokens":10');
    expect(output).toContain('"completion_tokens":20');
    expect(output).toContain('"finish_reason":"tool_calls"');
  });

  it("returns non-2xx chat responses for standard error handling", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "jwt"), { status: 200 });
      return new Response("quota", { status: 429 });
    });
    const result = await new DevinExecutor().execute({
      fetchImpl: global.fetch,
      model: "swe-1-7", body: { messages: [] }, stream: true, credentials: { accessToken: "token" },
    });
    expect(result.response.status).toBe(429);
  });

  it("emits a normalized error for a trailer frame", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "jwt"), { status: 200 });
      const trailer = Buffer.from(JSON.stringify({ error: { message: "quota exhausted" } }));
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(frameDevinConnect(trailer, false, true));
          controller.close();
        },
      }), { status: 200 });
    });
    const result = await new DevinExecutor().execute({
      fetchImpl: global.fetch,
      model: "swe-1-7", body: { messages: [] }, stream: true, credentials: { accessToken: "token" },
    });
    const output = await result.response.text();
    expect(output).toContain("quota exhausted");
    expect(output).toContain("[DONE]");
  });
});

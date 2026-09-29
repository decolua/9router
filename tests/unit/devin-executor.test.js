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
          controller.enqueue(frameDevinConnect(Buffer.from("{}"), false, true));
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

  it("assembles streamed argument fragments and parallel tool calls by index", async () => {
    const header = (id, name) => messageField(6, Buffer.concat([stringField(1, id), stringField(2, name)]));
    const args = (text) => messageField(6, stringField(3, text));
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "jwt"), { status: 200 });
      return new Response(new ReadableStream({
        start(controller) {
          for (const payload of [header("call_a", "get_weather"), args("{\"city\": "), header("call_b", "get_time"), args("{\"city\": \"Hanoi\"}"), messageField(6, Buffer.concat([stringField(1, "call_a"), stringField(3, "\"Hanoi\"}")]))]) {
            controller.enqueue(frameDevinConnect(payload));
          }
          controller.enqueue(frameDevinConnect(Buffer.from("{}"), false, true));
          controller.close();
        },
      }), { status: 200 });
    });

    const result = await new DevinExecutor().execute({
      fetchImpl: global.fetch,
      model: "swe-1-6",
      body: { messages: [{ role: "user", content: "hi" }], tools: [] },
      stream: true,
      credentials: { accessToken: "token" },
    });
    const calls = [];
    for (const line of (await result.response.text()).split("\n")) {
      if (!line.startsWith("data: {")) continue;
      for (const tc of JSON.parse(line.slice(6)).choices?.[0]?.delta?.tool_calls || []) {
        const call = (calls[tc.index] ??= { id: "", name: "", arguments: "" });
        call.id += tc.id || "";
        call.name += tc.function?.name || "";
        call.arguments += tc.function?.arguments || "";
      }
    }

    expect(calls).toEqual([
      { id: "call_a", name: "get_weather", arguments: "{\"city\": \"Hanoi\"}" },
      { id: "call_b", name: "get_time", arguments: "{\"city\": \"Hanoi\"}" },
    ]);
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
          controller.enqueue(frameDevinConnect(Buffer.from("{}"), false, true));
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

  it("forwards only the first tool call when parallel_tool_calls is false", async () => {
    const header = (id, name) => messageField(6, Buffer.concat([stringField(1, id), stringField(2, name)]));
    const args = (text) => messageField(6, stringField(3, text));
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "jwt"), { status: 200 });
      return new Response(new ReadableStream({
        start(controller) {
          for (const payload of [header("call_a", "get_weather"), args("{\"city\": "), header("call_b", "get_time"), args("{\"city\": \"Hanoi\"}"), messageField(6, Buffer.concat([stringField(1, "call_a"), stringField(3, "\"Hanoi\"}")]))]) {
            controller.enqueue(frameDevinConnect(payload));
          }
          controller.enqueue(frameDevinConnect(Buffer.from("{}"), false, true));
          controller.close();
        },
      }), { status: 200 });
    });
    const result = await new DevinExecutor().execute({
      fetchImpl: global.fetch,
      model: "swe-2-high",
      body: { messages: [{ role: "user", content: "hi" }], tools: [], parallel_tool_calls: false },
      stream: true,
      credentials: { accessToken: "token" },
    });
    const calls = [];
    const output = await result.response.text();
    for (const line of output.split("\n")) {
      if (!line.startsWith("data: {")) continue;
      for (const tc of JSON.parse(line.slice(6)).choices?.[0]?.delta?.tool_calls || []) {
        const call = (calls[tc.index] ??= { id: "", name: "", arguments: "" });
        call.id += tc.id || "";
        call.name += tc.function?.name || "";
        call.arguments += tc.function?.arguments || "";
      }
    }
    expect(calls).toEqual([{ id: "call_a", name: "get_weather", arguments: "{\"city\": \"Hanoi\"}" }]);
    expect(output).toContain('"finish_reason":"tool_calls"');
  });

  it("fails a stream that ends without the Connect end-stream frame", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "jwt"), { status: 200 });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(frameDevinConnect(stringField(3, "partial")));
          controller.close();
        },
      }), { status: 200 });
    });
    const result = await new DevinExecutor().execute({
      fetchImpl: global.fetch,
      model: "swe-1-7", body: { messages: [] }, stream: true, credentials: { accessToken: "token" },
    });
    const output = await result.response.text();
    expect(output).toContain("without a Connect end-stream frame");
    expect(output).not.toContain('"finish_reason":"stop"');
  });

  it("maps content-filter and max-token stop reasons", async () => {
    const run = async (reason) => {
      global.fetch = vi.fn(async (url) => {
        if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "jwt"), { status: 200 });
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(frameDevinConnect(Buffer.from([0x28, reason])));
            controller.enqueue(frameDevinConnect(Buffer.from("{}"), false, true));
            controller.close();
          },
        }), { status: 200 });
      });
      const result = await new DevinExecutor().execute({
        fetchImpl: global.fetch,
        model: "swe-1-7", body: { messages: [] }, stream: true, credentials: { accessToken: "token" },
      });
      return result.response.text();
    };
    expect(await run(3)).toContain('"finish_reason":"length"');
    expect(await run(11)).toContain('"finish_reason":"content_filter"');
    expect(await run(1)).toContain('"finish_reason":"stop"');
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
    expect(output).not.toContain('"finish_reason"');
  });
});

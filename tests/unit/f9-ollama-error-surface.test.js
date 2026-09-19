// F9 — /v1/api/chat (Ollama): erros e respostas non-stream não podem virar
// um 200 silencioso com content vazio.
//
// Shape canônico de erro do Ollama (docs da API + parser do repo):
// status HTTP real (400/401/404/500…) + corpo JSON {"error": "<mensagem>"} (string).
// Evidência no repo: open-sse/utils/error.js:81 trata `json.error` como string na
// resposta de erro upstream do Ollama (`parseUpstreamError`: `json.error?.message ||
// json.message || json.error || bodyText`); executors/ollama-local.js delega ao
// DefaultExecutor, que consome erros exatamente por esse caminho.
import { describe, expect, it, vi } from "vitest";

import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";
import { errorResponse } from "../../open-sse/utils/error.js";

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: vi.fn() }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => {}) }));

const { handleChat } = await import("@/sse/handlers/chat.js");
const { POST } = await import("../../src/app/api/v1/api/chat/route.js");

function sseResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" },
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function ndjsonLines(text) {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function chatRequest(overrides = {}) {
  return new Request("http://localhost:20128/v1/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.2",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      ...overrides,
    }),
  });
}

describe("F9(a) — handleChat errors keep the real HTTP status + canonical Ollama {\"error\":\"...\"}", () => {
  it.each([
    [401, "Missing API key"],
    [401, "Invalid API key"],
    [400, "Missing model"],
    [400, "Invalid JSON body"],
    [404, "No active credentials for provider: ollama"],
    [503, "All accounts unavailable"],
  ])("errorResponse(%i, ...) → %i with string error body", async (status, message) => {
    const res = await transformToOllama(errorResponse(status, message), "llama3.2");
    expect(res.status).toBe(status);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).toBe(message);
  });

  it("passes through upstream-shaped {\"error\":\"str\"} bodies with the real status", async () => {
    const res = await transformToOllama(
      jsonResponse({ error: "model \"foo\" not found" }, 404),
      "foo",
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("model \"foo\" not found");
  });

  it("never emits an empty-content NDJSON success for a failed request", async () => {
    const res = await transformToOllama(errorResponse(401, "Invalid API key"), "llama3.2");
    const text = await res.text();
    expect(res.status).not.toBe(200);
    expect(text).not.toContain('"done":true,"content":""');
    expect(text).not.toContain('"content":""');
  });
});

describe("F9(b) — non-stream single JSON completion is converted, not dropped", () => {
  it("converts an OpenAI chat.completion into one Ollama chat response", async () => {
    const completion = {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1700000000,
      model: "gpt-4o-mini",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    const res = await transformToOllama(jsonResponse(completion), "llama3.2");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.message?.role).toBe("assistant");
    expect(body.message?.content).toBe("Hello!");
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("converts a non-stream completion with tool_calls (arguments parsed to object)", async () => {
    const completion = {
      object: "chat.completion",
      model: "llama3.2",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: "{\"city\":\"SF\"}" },
          }],
        },
        finish_reason: "tool_calls",
      }],
    };
    const res = await transformToOllama(jsonResponse(completion), "llama3.2");
    const body = await res.json();
    expect(body.done).toBe(true);
    const calls = body.message?.tool_calls;
    expect(Array.isArray(calls)).toBe(true);
    expect(calls[0].function.name).toBe("get_weather");
    expect(calls[0].function.arguments).toEqual({ city: "SF" });
  });

  it("surfaces an error envelope found inside an application/json success body", async () => {
    const res = await transformToOllama(
      jsonResponse({ error: { message: "gateway inconsistency" } }),
      "llama3.2",
    );
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("gateway inconsistency");
  });
});

describe("F9(c) — streaming SSE keeps content and emits exactly one terminal event", () => {
  it("multi-line NDJSON out with all content and a single done:true", async () => {
    const sse = [
      `data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n`,
      `data: {"choices":[{"index":0,"delta":{"content":", world"},"finish_reason":null}]}\n\n`,
      `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`,
      `data: [DONE]\n\n`,
    ].join("");
    const res = await transformToOllama(sseResponse(sse), "m");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = ndjsonLines(await res.text());
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.done !== true || e.model === "m")).toBe(true);
    expect(events.map((e) => e.message?.content || "").join("")).toBe("Hello, world");
    const terminal = events.filter((e) => e.done === true);
    expect(terminal).toHaveLength(1);
    expect(events[events.length - 1].done).toBe(true);
    expect(events.filter((e) => e.error)).toHaveLength(0);
  });

  it("tool_calls stream still emits merged tool call + terminal done", async () => {
    const sse = [
      `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_weather","arguments":"{\\"city\\":"}}]}}]}\n\n`,
      `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"SF\\"}"}}]}}]}\n\n`,
      `data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n`,
      `data: [DONE]\n\n`,
    ].join("");
    const res = await transformToOllama(sseResponse(sse), "m");
    const events = ndjsonLines(await res.text());
    const withTools = events.filter((e) => e.message?.tool_calls?.length);
    expect(withTools).toHaveLength(1);
    expect(withTools[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(withTools[0].message.tool_calls[0].function.arguments).toEqual({ city: "SF" });
    expect(events.filter((e) => e.done === true)).toHaveLength(1);
  });

  it("a final line without trailing newline is not silently dropped", async () => {
    const sse = `data: {"choices":[{"index":0,"delta":{"content":"Tail"}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`;
    const res = await transformToOllama(sseResponse(sse), "m");
    const events = ndjsonLines(await res.text());
    expect(events.map((e) => e.message?.content || "").join("")).toBe("Tail");
    expect(events.filter((e) => e.done === true)).toHaveLength(1);
  });
});

describe("F9(d) — parser accepts pure JSON lines (NDJSON), not only SSE `data:`", () => {
  it("converts a raw JSON-lines OpenAI stream without data: prefix", async () => {
    const ndjson = [
      `{"choices":[{"index":0,"delta":{"content":"Ping"}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      "",
    ].join("\n");
    const res = await transformToOllama(
      new Response(ndjson, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }),
      "m",
    );
    const events = ndjsonLines(await res.text());
    expect(events.map((e) => e.message?.content || "").join("")).toBe("Ping");
    expect(events.filter((e) => e.done === true)).toHaveLength(1);
  });
});

describe("F9(e) — mid-stream error surfaces as an {\"error\":\"...\"} event, never a fake empty done", () => {
  it("emits the error line and suppresses the flush done", async () => {
    const sse = [
      `data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n`,
      `data: {"error":{"message":"upstream exploded"}}\n\n`,
      `data: [DONE]\n\n`,
    ].join("");
    const res = await transformToOllama(sseResponse(sse), "m");
    const events = ndjsonLines(await res.text());
    const errEvents = events.filter((e) => e.error);
    expect(errEvents).toHaveLength(1);
    expect(typeof errEvents[0].error).toBe("string");
    expect(errEvents[0].error).toContain("upstream exploded");
    // No empty-content done faking a successful completion.
    expect(events.filter((e) => e.done === true)).toHaveLength(0);
  });
});

describe("F9(route) — POST /v1/api/chat propagates status and never 200s on throw", () => {
  it("returns the handleChat error status/body through the route", async () => {
    handleChat.mockReset();
    handleChat.mockResolvedValue(errorResponse(401, "Invalid API key"));
    const res = await POST(chatRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid API key");
  });

  it("converts a successful non-stream completion via the route (content preserved)", async () => {
    handleChat.mockReset();
    handleChat.mockResolvedValue(jsonResponse({
      object: "chat.completion",
      model: "llama3.2",
      choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
    }));
    const res = await POST(chatRequest({ stream: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message?.content).toBe("pong");
    expect(body.done).toBe(true);
  });

  it("returns 500 {\"error\":...} when handleChat throws", async () => {
    handleChat.mockReset();
    handleChat.mockRejectedValue(new Error("router crashed"));
    const res = await POST(chatRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("router crashed");
  });
});

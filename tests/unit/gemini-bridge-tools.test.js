import { describe, it, expect } from "vitest";
import {
  convertGeminiToInternal,
  transformOpenAISSEToGeminiSSE,
  convertOpenAIResponseToGemini,
  keepAliveGeminiSSE,
} from "@/lib/geminiBridge.js";

const tool = {
  functionDeclarations: [{
    name: "run_shell", description: "Run a shell command",
    parameters: { type: "OBJECT", properties: { command: { type: "STRING" } }, required: ["command"] },
  }],
};

describe("v1beta Gemini bridge: tools", () => {
  it("keeps parametersJsonSchema (what Gemini CLI sends)", () => {
    const schema = { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] };
    const out = convertGeminiToInternal({
      contents: [{ role: "user", parts: [{ text: "read a.txt" }] }],
      tools: [{ functionDeclarations: [{ name: "read_file", description: "Read", parametersJsonSchema: schema }] }],
    }, "ag/gemini-3.8-flash-high", true);
    expect(out.tools[0].function.parameters.required).toEqual(["file_path"]);
  });

  it("request keeps tools, functionCall and functionResponse", () => {
    const out = convertGeminiToInternal({
      contents: [
        { role: "user", parts: [{ text: "run echo hi" }] },
        { role: "model", parts: [{ functionCall: { name: "run_shell", args: { command: "echo hi" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "run_shell", response: { result: "hi" } } }] },
      ],
      tools: [tool],
    }, "ag/gemini-3.8-flash-high", true);
    expect(out.model).toBe("ag/gemini-3.8-flash-high");
    expect(out.stream).toBe(true);
    expect(out.tools?.[0]?.function?.name).toBe("run_shell");
    expect(out.messages.some((m) => m.tool_calls?.[0]?.function?.name === "run_shell")).toBe(true);
    expect(out.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("stream: fragmented tool_calls (split mid-line) become one functionCall", async () => {
    const events = [
      { choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_", arguments: "" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "shell", arguments: "{\"command\":" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"echo hi\"}" } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
    ];
    const sse = events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n";
    const enc = new TextEncoder();
    const cut = [7, 61, 140, 230];                       // split inside lines on purpose
    const pieces = []; let last = 0;
    for (const c of cut) { pieces.push(sse.slice(last, c)); last = c; }
    pieces.push(sse.slice(last));
    const upstream = new Response(new ReadableStream({
      start(ctrl) { for (const p of pieces) ctrl.enqueue(enc.encode(p)); ctrl.close(); },
    }), { status: 200 });

    const res = transformOpenAISSEToGeminiSSE(upstream, "m");
    const text = await res.text();
    const chunks = text.split("\r\n\r\n").filter(Boolean).map((l) => JSON.parse(l.slice(5)));
    const calls = chunks.flatMap((c) => c.candidates[0].content.parts).filter((p) => p.functionCall);
    expect(calls).toHaveLength(1);
    expect(calls[0].functionCall).toEqual({ name: "run_shell", args: { command: "echo hi" }, id: "call_1" });
    expect(chunks.at(-1).usageMetadata.totalTokenCount).toBe(8);
  });

  it("non-stream: message.tool_calls become functionCall parts", async () => {
    const upstream = Response.json({
      model: "m",
      choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
        tool_calls: [{ id: "call_9", type: "function", function: { name: "run_shell", arguments: "{\"command\":\"ls\"}" } }] } }],
    });
    const res = await convertOpenAIResponseToGemini(upstream, "m");
    const body = await res.json();
    const parts = body.candidates[0].content.parts;
    expect(parts).toEqual([{ functionCall: { name: "run_shell", args: { command: "ls" }, id: "call_9" } }]);
  });

  it("plain text replies are unchanged", async () => {
    const upstream = Response.json({ model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "pong" } }] });
    const body = await (await convertOpenAIResponseToGemini(upstream, "m")).json();
    expect(body.candidates[0].content.parts).toEqual([{ text: "pong" }]);
  });

  it("keepalive: pings while the upstream is slow, then the real chunks", async () => {
    const sse = "data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: "pong" }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n";
    const slow = new Promise((r) => setTimeout(() => r(new Response(sse, { status: 200 })), 260));
    const text = await keepAliveGeminiSSE(slow, "m", 50).text();
    const chunks = text.split("\r\n\r\n").filter(Boolean).map((l) => JSON.parse(l.slice(5)));
    const pings = chunks.filter((c) => c.candidates?.[0]?.content?.parts?.[0]?.text === "" && !c.candidates[0].finishReason);
    expect(pings.length).toBeGreaterThanOrEqual(3);
    expect(chunks.at(-1).candidates[0].content.parts[0].text).toBe("pong");
  });

  it("keepalive: a fast upstream gets no pings; an upstream error becomes an error chunk", async () => {
    const fast = Promise.resolve(new Response("data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }] }) + "\n\n", { status: 200 }));
    const t1 = await keepAliveGeminiSSE(fast, "m", 1000).text();
    expect(t1.split("\r\n\r\n").filter(Boolean)).toHaveLength(1);
    const bad = Promise.resolve(new Response("rate limited", { status: 429 }));
    const t2 = await keepAliveGeminiSSE(bad, "m", 1000).text();
    expect(JSON.parse(t2.trim().slice(5)).error.code).toBe(429);
  });
});

describe("v1beta keepalive: hung upstream", () => {
  it("closes with a 504 error when upstream stays silent past idleMs", async () => {
    const res = keepAliveGeminiSSE(new Promise(() => {}), "m", 20, 80);
    const text = await res.text();
    expect(text).toContain('"code":504');
  });
});

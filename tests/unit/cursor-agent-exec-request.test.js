import { afterEach, describe, it, expect, vi } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import {
  decodeMessage,
  encodeAgentValue,
  encodeField,
  wrapConnectRPCFrame,
} from "../../open-sse/utils/cursorProtobuf.js";

const VARINT = 0;
const LEN = 2;

// agent.v1.AgentServerMessage.exec_request (field 2) carrying one ExecServerMessage variant.
function execRequestFrame(execField, value = new Uint8Array(), { id, execId } = {}) {
  const execServerMessage = Buffer.concat([
    ...(id != null ? [Buffer.from(encodeField(1, VARINT, id))] : []),
    Buffer.from(encodeField(execField, LEN, value)),
    ...(execId ? [Buffer.from(encodeField(15, LEN, execId))] : []),
  ]);
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, execServerMessage)));
}

function mcpExecFrame({ name = "get_weather", callId = "call_abc", args = { city: "Hanoi" }, id, execId } = {}) {
  const entries = Object.entries(args).map(([key, value]) => encodeField(2, LEN, Buffer.concat([
    Buffer.from(encodeField(1, LEN, key)),
    Buffer.from(encodeField(2, LEN, encodeAgentValue(value))),
  ])));
  const mcpArgs = Buffer.concat([
    Buffer.from(encodeField(1, LEN, name)),
    ...entries.map(Buffer.from),
    ...(callId ? [Buffer.from(encodeField(3, LEN, callId))] : []),
    Buffer.from(encodeField(5, LEN, name)),
  ]);
  return execRequestFrame(11, mcpArgs, { id, execId });
}

// agent.v1.AgentServerMessage.interaction_update (field 1) → text delta.
function textFrame(text) {
  const textPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(1, LEN, textPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function stubAgentSession(executor, frames) {
  const written = [];
  const queue = [...frames];
  executor.openAgentHttp2Stream = () => ({
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write: (frame) => written.push(Buffer.from(frame)),
    end() {},
    close() {},
    async read() {
      if (!queue.length) return { value: undefined, done: true };
      return { value: queue.shift(), done: false };
    },
  });
  return written;
}

function stubRetainedAgentSession(executor, frames) {
  const written = [];
  const queue = [...frames];
  let openCount = 0;
  let closeCount = 0;
  const session = {
    responseHeaders: Promise.resolve({ ":status": 200 }),
    write: (frame) => written.push(Buffer.from(frame)),
    end() {},
    close() { closeCount++; },
    async read() {
      if (!queue.length) return { value: undefined, done: true };
      const value = queue.shift();
      if (value instanceof Error) throw value;
      return { value, done: false };
    },
  };
  executor.openAgentHttp2Stream = () => {
    openCount++;
    return session;
  };
  return {
    written,
    get openCount() { return openCount; },
    get closeCount() { return closeCount; },
  };
}

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

afterEach(() => {
  vi.useRealTimers();
});

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

function toolResultContent(results) {
  return results.map(({ name, id, content, isError = false }) => [
    "<tool_result>",
    `<tool_name>${name}</tool_name>`,
    `<tool_call_id>${id}</tool_call_id>`,
    ...(isError ? ["<is_error>true</is_error>"] : []),
    `<result>${content}</result>`,
    "</tool_result>",
  ].join("\n")).join("\n");
}

function decodeMcpResultFrame(frame) {
  const clientMessage = decodeMessage(frame.subarray(5));
  const execResponse = decodeMessage(clientMessage.get(2)[0].value);
  return {
    execResponse,
    mcpResult: decodeMessage(execResponse.get(11)[0].value),
  };
}

async function runAgent({ frames, stream, body, model = "gpt-5.2", modelCatalog }) {
  const executor = new CursorExecutor();
  const written = stubAgentSession(executor, frames);
  const result = await executor.executeAgent({
    model,
    body: body || { messages: [{ role: "user", content: "hi" }] },
    stream,
    credentials,
    modelCatalog,
  });
  return { result, written };
}

describe("CursorExecutor AgentService exec_request handling", () => {
  it("uses catalog parameters when building a variant Run request", async () => {
    const { result, written } = await runAgent({
      frames: [textFrame("ok")],
      stream: true,
      model: "cursor-grok-4.5-high",
      modelCatalog: [{
        id: "grok-4.5",
        variants: [{
          legacySlug: "cursor-grok-4.5-high",
          parameters: [
            { id: "effort", value: "high" },
            { id: "fast", value: "false" },
          ],
        }],
      }],
    });
    await result.response.text();

    const clientMessage = decodeMessage(written[0].subarray(5));
    const runRequest = decodeMessage(clientMessage.get(1)[0].value);
    const requestedModel = decodeMessage(runRequest.get(9)[0].value);
    expect(Buffer.from(requestedModel.get(1)[0].value).toString("utf8")).toBe("grok-4.5");
    expect(requestedModel.get(3)).toHaveLength(2);
  });

  it("acknowledges a request-context exec request without ending the turn", async () => {
    const { result, written } = await runAgent({
      frames: [execRequestFrame(10), textFrame("hello")],
      stream: true,
    });

    expect(written.length).toBe(2); // run frame + request-context reply
    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("hello");
  });

  it("copies request-context correlation fields and advertises tools in field 7", async () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ function: { name: "get_weather", parameters: { type: "object" } } }],
    };
    const { result, written } = await runAgent({
      frames: [execRequestFrame(10, new Uint8Array(), { id: 42, execId: "exec-id" }), textFrame("ok")],
      stream: true,
      body,
    });
    await result.response.text();

    const clientMessage = decodeMessage(written[1].subarray(5));
    const execResponse = decodeMessage(clientMessage.get(2)[0].value);
    expect(execResponse.get(1)[0].value).toBe(42);
    expect(Buffer.from(execResponse.get(15)[0].value).toString()).toBe("exec-id");
    const resultMessage = decodeMessage(execResponse.get(10)[0].value);
    const success = decodeMessage(resultMessage.get(1)[0].value);
    const context = decodeMessage(success.get(1)[0].value);
    expect(context.has(7)).toBe(true);
    expect(context.get(7)).toHaveLength(1);
    expect(Buffer.from(decodeMessage(context.get(7)[0].value).get(1)[0].value).toString()).toBe("get_weather");
  });

  it("returns an empty MCP resource list and continues the turn", async () => {
    const spanContext = Buffer.concat([
      Buffer.from(encodeField(1, LEN, "a".repeat(32))),
      Buffer.from(encodeField(2, LEN, "b".repeat(16))),
      Buffer.from(encodeField(3, VARINT, 1)),
    ]);
    const execServerMessage = Buffer.concat([
      Buffer.from(encodeField(1, VARINT, 1)),
      Buffer.from(encodeField(15, LEN, "exec-id")),
      Buffer.from(encodeField(17, LEN, new Uint8Array())),
      Buffer.from(encodeField(19, LEN, spanContext)),
      Buffer.from(encodeField(55, VARINT, 1)),
    ]);
    const frame = Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, execServerMessage)));

    const { result, written } = await runAgent({
      frames: [frame, textFrame("continued")],
      stream: true,
    });
    const events = parseSSE(await result.response.text());
    expect(events.map((event) => event.choices?.[0]?.delta?.content || "").join(""))
      .toBe("continued");

    expect(written).toHaveLength(2);
    const clientMessage = decodeMessage(written[1].subarray(5));
    const execResponse = decodeMessage(clientMessage.get(2)[0].value);
    expect(execResponse.get(1)[0].value).toBe(1);
    expect(Buffer.from(execResponse.get(15)[0].value).toString()).toBe("exec-id");
    const listResult = decodeMessage(execResponse.get(17)[0].value);
    expect(listResult.has(1)).toBe(true);
    expect(listResult.get(1)[0].value).toHaveLength(0);
  });

  it("emits an MCP exec request as a streaming OpenAI tool call and ends the turn", async () => {
    const { result, written } = await runAgent({
      frames: [Buffer.concat([mcpExecFrame(), textFrame("late")])],
      stream: true,
    });

    const events = parseSSE(await result.response.text());
    const toolCall = events.find((event) => event.choices?.[0]?.delta?.tool_calls)?.choices[0].delta.tool_calls[0];
    expect(toolCall).toMatchObject({
      id: "call_abc",
      type: "function",
      function: { name: "get_weather", arguments: JSON.stringify({ city: "Hanoi" }) },
    });
    expect(events.at(-1).choices[0].finish_reason).toBe("tool_calls");
    expect(JSON.stringify(events)).not.toContain("late");
    expect(written).toHaveLength(1); // no fabricated MCP result
  });

  it("emits an MCP exec request as a non-streaming OpenAI tool call", async () => {
    const { result, written } = await runAgent({ frames: [mcpExecFrame()], stream: false });
    expect(result.response.status).toBe(200);
    const payload = await result.response.json();
    expect(payload.choices[0].finish_reason).toBe("tool_calls");
    expect(payload.choices[0].message.tool_calls[0].function).toEqual({
      name: "get_weather",
      arguments: JSON.stringify({ city: "Hanoi" }),
    });
    expect(written).toHaveLength(1);
  });

  it("uses a numeric exec request id when MCP args omit tool_call_id", async () => {
    const { result } = await runAgent({
      frames: [mcpExecFrame({ callId: "", id: 7 })],
      stream: false,
    });
    const payload = await result.response.json();
    expect(payload.choices[0].message.tool_calls[0].id).toMatch(/^call_[0-9a-f-]{36}$/);
  });

  it("resumes the retained stream with a normalized MCP result", async () => {
    const executor = new CursorExecutor();
    const session = stubRetainedAgentSession(executor, [
      mcpExecFrame({ callId: "call_abc\nmc_internal", id: 7, execId: "exec-7" }),
      textFrame("finished"),
    ]);

    const first = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "weather?" }] },
      stream: false,
      credentials,
    });
    const firstPayload = await first.response.json();
    expect(firstPayload.choices[0].message.tool_calls[0].id).toBe("call_abc");

    const second = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "get_weather", id: "call_abc", content: "32 C" },
      ]) }] },
      stream: false,
      credentials,
    });
    const secondPayload = await second.response.json();

    expect(secondPayload.choices[0].message.content).toBe("finished");
    expect(session.openCount).toBe(1);
    expect(session.closeCount).toBe(1);
    expect(session.written).toHaveLength(2); // run request + native MCP result
    const { execResponse, mcpResult } = decodeMcpResultFrame(session.written[1]);
    expect(execResponse.get(1)[0].value).toBe(7);
    expect(Buffer.from(execResponse.get(15)[0].value).toString()).toBe("exec-7");
    const success = decodeMessage(mcpResult.get(1)[0].value);
    const item = decodeMessage(success.get(1)[0].value);
    const text = decodeMessage(item.get(1)[0].value);
    expect(Buffer.from(text.get(1)[0].value).toString()).toBe("32 C");
  });

  it("ignores consumed historical results across consecutive native resumes", async () => {
    const executor = new CursorExecutor();
    const session = stubRetainedAgentSession(executor, [
      mcpExecFrame({ name: "first_tool", callId: "call_1", id: 1 }),
      mcpExecFrame({ name: "second_tool", callId: "call_2", id: 2 }),
      textFrame("all done"),
    ]);

    const initial = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "do both" }] },
      stream: false,
      credentials,
    });
    expect((await initial.response.json()).choices[0].message.tool_calls[0].id).toBe("call_1");

    const firstResume = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "first_tool", id: "call_1", content: "one" },
      ]) }] },
      stream: false,
      credentials,
    });
    expect((await firstResume.response.json()).choices[0].message.tool_calls[0].id).toBe("call_2");

    const secondResume = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "first_tool", id: "call_1", content: "one" },
        { name: "second_tool", id: "call_2", content: "two" },
      ]) }] },
      stream: false,
      credentials,
    });
    expect((await secondResume.response.json()).choices[0].message.content).toBe("all done");

    expect(session.openCount).toBe(1);
    expect(session.written).toHaveLength(3); // one run and each result exactly once
    expect(decodeMcpResultFrame(session.written[1]).execResponse.get(1)[0].value).toBe(1);
    expect(decodeMcpResultFrame(session.written[2]).execResponse.get(1)[0].value).toBe(2);
  });

  it("buffers a second MCP exec delivered in the same HTTP/2 chunk", async () => {
    const executor = new CursorExecutor();
    const session = stubRetainedAgentSession(executor, [
      Buffer.concat([
        mcpExecFrame({ name: "first_tool", callId: "call_batch_1", id: 1 }),
        mcpExecFrame({ name: "second_tool", callId: "call_batch_2", id: 2 }),
      ]),
      textFrame("batch done"),
    ]);

    const initial = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "do both" }] },
      stream: false,
      credentials,
    });
    expect((await initial.response.json()).choices[0].message.tool_calls[0].id).toBe("call_batch_1");

    const firstResume = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "first_tool", id: "call_batch_1", content: "one" },
      ]) }] },
      stream: false,
      credentials,
    });
    expect((await firstResume.response.json()).choices[0].message.tool_calls[0].id).toBe("call_batch_2");

    const secondResume = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "second_tool", id: "call_batch_2", content: "two" },
      ]) }] },
      stream: false,
      credentials,
    });
    expect((await secondResume.response.json()).choices[0].message.content).toBe("batch done");
    expect(session.openCount).toBe(1);
    expect(session.written).toHaveLength(3);
  });

  it("does not acquire a retained session from another account", async () => {
    const ownerExecutor = new CursorExecutor();
    const ownerSession = stubRetainedAgentSession(ownerExecutor, [mcpExecFrame({ callId: "shared_call" })]);
    const ownerAbort = new AbortController();
    const initial = await ownerExecutor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "run tool" }] },
      stream: false,
      credentials: { ...credentials, connectionId: "account-a" },
      signal: ownerAbort.signal,
    });
    await initial.response.json();

    const otherExecutor = new CursorExecutor();
    const otherSession = stubRetainedAgentSession(otherExecutor, [textFrame("cold fallback")]);
    const other = await otherExecutor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "get_weather", id: "shared_call", content: "result" },
      ]) }] },
      stream: false,
      credentials: { ...credentials, connectionId: "account-b" },
    });
    expect((await other.response.json()).choices[0].message.content).toBe("cold fallback");
    expect(ownerSession.written).toHaveLength(1);
    expect(otherSession.openCount).toBe(1);
    expect(otherSession.written).toHaveLength(1);
    ownerAbort.abort();
  });

  it("marks a native MCP result as an error", async () => {
    const executor = new CursorExecutor();
    const session = stubRetainedAgentSession(executor, [
      mcpExecFrame({ callId: "call_error" }),
      textFrame("recovered"),
    ]);

    const initial = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "run tool" }] },
      stream: false,
      credentials,
    });
    await initial.response.json();
    const resumed = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "get_weather", id: "call_error", content: "tool failed", isError: true },
      ]) }] },
      stream: false,
      credentials,
    });
    expect((await resumed.response.json()).choices[0].message.content).toBe("recovered");

    const { mcpResult } = decodeMcpResultFrame(session.written[1]);
    const success = decodeMessage(mcpResult.get(1)[0].value);
    expect(success.get(2)[0].value).toBe(1);
  });

  it("closes a retained session when the resumed HTTP/2 stream fails", async () => {
    const executor = new CursorExecutor();
    const session = stubRetainedAgentSession(executor, [
      mcpExecFrame({ callId: "call_failure" }),
      new Error("stream failed"),
    ]);

    const initial = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "run tool" }] },
      stream: false,
      credentials,
    });
    await initial.response.json();

    await expect(executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "get_weather", id: "call_failure", content: "result" },
      ]) }] },
      stream: false,
      credentials,
    })).rejects.toThrow("stream failed");
    expect(session.closeCount).toBe(1);
  });

  it("closes a fresh session when response headers reject", async () => {
    const executor = new CursorExecutor();
    let closeCount = 0;
    executor.openAgentHttp2Stream = () => ({
      responseHeaders: Promise.reject(new Error("headers failed")),
      write() {},
      close() { closeCount++; },
    });

    await expect(executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
    })).rejects.toThrow("headers failed");
    expect(closeCount).toBe(1);
  });

  it("expires retained sessions after five minutes", async () => {
    vi.useFakeTimers();
    const executor = new CursorExecutor();
    const session = stubRetainedAgentSession(executor, [mcpExecFrame({ callId: "call_ttl" })]);

    const initial = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "run tool" }] },
      stream: false,
      credentials,
    });
    await initial.response.json();
    expect(session.closeCount).toBe(0);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(session.closeCount).toBe(1);

    const fallback = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "get_weather", id: "call_ttl", content: "late" },
      ]) }] },
      stream: false,
      credentials,
    });
    expect((await fallback.response.json()).choices[0].finish_reason).toBe("stop");
    expect(session.openCount).toBe(2); // expired lookup starts a cold fallback run
    expect(session.written).toHaveLength(2); // two run frames, no MCP result
  });

  it("closes a retained session when an already-aborted continuation arrives", async () => {
    const executor = new CursorExecutor();
    const session = stubRetainedAgentSession(executor, [mcpExecFrame({ callId: "call_abort" })]);

    const initial = await executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: "run tool" }] },
      stream: false,
      credentials,
    });
    await initial.response.json();

    const controller = new AbortController();
    controller.abort();
    await expect(executor.executeAgent({
      model: "gpt-5.2",
      body: { messages: [{ role: "user", content: toolResultContent([
        { name: "get_weather", id: "call_abort", content: "result" },
      ]) }] },
      stream: false,
      credentials,
      signal: controller.signal,
    })).rejects.toThrow();
    expect(session.closeCount).toBe(1);
  });

  it("does not render an unsupported exec request as assistant content", async () => {
    const { result } = await runAgent({
      frames: [textFrame("partial answer"), execRequestFrame(2)],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool\\n");
    const events = parseSSE(body);
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("partial answer");

    const errorEvent = events.find((e) => e.error);
    expect(errorEvent?.error?.message).toContain("unsupported IDE tool");
    expect(events.some((e) => e.choices?.[0]?.finish_reason === "stop")).toBe(false);
  });

  it("drops frames batched behind an unsupported exec request in the same read", async () => {
    const { result } = await runAgent({
      frames: [Buffer.concat([execRequestFrame(2), textFrame("late")])],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).toContain("unsupported IDE tool");
    expect(body).not.toContain("late");
  });

  it("returns a non-200 error body for an unsupported exec request when not streaming", async () => {
    const { result } = await runAgent({
      frames: [execRequestFrame(2)],
      stream: false,
    });

    expect(result.response.status).not.toBe(200);
    const payload = await result.response.json();
    expect(payload.error.message).toContain("unsupported IDE tool");
  });
});

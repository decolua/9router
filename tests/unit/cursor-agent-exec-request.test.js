import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { decodeMessage, encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

// agent.v1.AgentServerMessage.exec_request (field 2) carrying one ExecServerMessage variant.
function execRequestFrame(execField) {
  const execServerMessage = Buffer.from(encodeField(execField, LEN, new Uint8Array()));
  return Buffer.from(wrapConnectRPCFrame(encodeField(2, LEN, execServerMessage)));
}

// agent.v1.AgentServerMessage.interaction_update (field 1) → text delta.
function textFrame(text) {
  const textPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(1, LEN, textPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

// InteractionUpdate.thinking_delta (field 4) + turn_ended (field 14).
function thinkingFrame(text) {
  const thinkingPart = Buffer.from(encodeField(1, LEN, text));
  const update = Buffer.from(encodeField(4, LEN, thinkingPart));
  return Buffer.from(wrapConnectRPCFrame(encodeField(1, LEN, update)));
}

function turnEndedFrame() {
  const update = Buffer.from(encodeField(14, LEN, new Uint8Array()));
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

const credentials = {
  accessToken: "test-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

async function runAgent({ frames, stream, model = "gpt-5.2", tools }) {
  const executor = new CursorExecutor();
  const written = stubAgentSession(executor, frames);
  const result = await executor.executeAgent({
    model,
    body: { messages: [{ role: "user", content: "hi" }], ...(tools ? { tools } : {}) },
    stream,
    credentials,
  });
  return { result, written };
}

describe("CursorExecutor AgentService exec_request handling", () => {
  for (const intent of [{ reasoning_effort: "high" }, { reasoning: { effort: "high" } }]) {
    it(`passes ${Object.keys(intent)[0]} through the AgentService executor`, async () => {
      const executor = new CursorExecutor();
      const written = stubAgentSession(executor, [textFrame("hello"), turnEndedFrame()]);
      const result = await executor.executeAgent({
        model: "gpt-5.2", body: { messages: [{ role: "user", content: "hi" }], ...intent },
        stream: false, credentials,
      });
      expect(result.response.status).toBe(200);
      const run = decodeMessage(decodeMessage(written[0].subarray(5)).get(1)[0].value);
      const requested = decodeMessage(run.get(9)[0].value);
      const parameter = decodeMessage(requested.get(3)[0].value);
      expect(Buffer.from(parameter.get(1)[0].value).toString()).toBe("reasoning");
      expect(Buffer.from(parameter.get(2)[0].value).toString()).toBe("high");
    });
  }

  for (const frames of [[], [turnEndedFrame()]]) {
    it(`rejects an empty ${frames.length ? "explicit turn" : "EOF"} without a successful SSE stop`, async () => {
      const { result } = await runAgent({ frames, stream: true });
      const text = await result.response.text();
      const events = parseSSE(text);
      expect(events.filter((event) => event.error)).toHaveLength(1);
      expect(events.some((event) => event.choices?.[0]?.finish_reason === "stop")).toBe(false);
      expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
    });

    it(`rejects an empty ${frames.length ? "explicit turn" : "EOF"} for non-stream clients`, async () => {
      const { result } = await runAgent({ frames, stream: false });
      expect(result.response.status).toBe(400);
      expect((await result.response.json()).error.message).toContain("empty turn");
    });
  }

  it("does not emit successful completion when reading the stream fails", async () => {
    const executor = new CursorExecutor();
    const written = stubAgentSession(executor, []);
    const open = executor.openAgentHttp2Stream;
    executor.openAgentHttp2Stream = (...args) => ({
      ...open(...args),
      async read() { throw new Error("transport interrupted"); },
    });
    const { response } = await executor.executeAgent({
      model: "gpt-5.2", body: { messages: [{ role: "user", content: "hi" }] },
      stream: true, credentials,
    });
    await expect(response.text()).rejects.toThrow("transport interrupted");
    expect(written).toHaveLength(1);
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

  it("does not echo client tools on the request_context ack", async () => {
    const { written, result } = await runAgent({
      tools: [{ function: { name: "read_file", parameters: { type: "object" } } }],
      frames: [execRequestFrame(10), textFrame("hello")],
      stream: true,
    });

    expect(written.length).toBe(2);
    expect(written[1].toString("utf8")).not.toContain("read_file");
    const content = parseSSE(await result.response.text())
      .map((e) => e.choices?.[0]?.delta?.content || "")
      .join("");
    expect(content).toBe("hello");
  });

  it("does not render an unsupported exec request as assistant content", async () => {
    const { result, written } = await runAgent({
      frames: [textFrame("partial answer"), execRequestFrame(2), textFrame(" more")],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool");
    const events = parseSSE(body);
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("partial answer more");
    expect(events.some((e) => e.error)).toBe(false);
    expect(written.length).toBe(2); // run frame + IDE rejection
  });

  it("still emits later text after rejecting an IDE exec in the same read", async () => {
    const { result } = await runAgent({
      frames: [Buffer.concat([execRequestFrame(2), textFrame("late")])],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool");
    expect(body).toContain("late");
  });

  it("returns a non-200 error body for an unsupported exec request when not streaming", async () => {
    const { result } = await runAgent({
      frames: [execRequestFrame(11)],
      stream: false,
    });

    expect(result.response.status).not.toBe(200);
    const payload = await result.response.json();
    expect(payload.error.message).toContain("unsupported IDE tool");
  });

  it("streams Composer visible content from thinking_delta after </think>", async () => {
    const { result } = await runAgent({
      model: "composer-2.5",
      frames: [
        thinkingFrame("private reasoning that must not leak</think>OK"),
        turnEndedFrame(),
      ],
      stream: true,
    });

    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("OK");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
  });

  it("flushes Grok thinking as visible content when the turn has no text_delta", async () => {
    const { result } = await runAgent({
      model: "grok-4.5",
      frames: [thinkingFrame("hello from grok"), turnEndedFrame()],
      stream: true,
    });

    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("hello from grok");
  });
});

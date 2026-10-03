import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

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

// Field numbers present in a Connect streaming frame (1 flag byte + 4 length
// bytes), descending into length-delimited payloads so nested messages count.
function protobufFieldNumbers(buf, start = 5, end = buf.length) {
  const numbers = [];
  let i = start;
  while (i < end) {
    let tag = 0;
    let shift = 0;
    let byte;
    do {
      byte = buf[i++];
      tag |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    numbers.push(tag >>> 3);
    const wire = tag & 7;
    if (wire === 2) {
      let len = 0;
      shift = 0;
      do {
        byte = buf[i++];
        len |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      numbers.push(...protobufFieldNumbers(buf, i, i + len));
      i += len;
    } else if (wire === 0) {
      while (buf[i++] & 0x80);
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    }
  }
  return numbers;
}

describe("CursorExecutor AgentService exec_request handling", () => {
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

  it("answers every mapped exec variant instead of failing the turn", async () => {
    const variants = [
      2, 3, 4, 5, 7, 8, 9, 14, 16, 17, 18, 20, 21, 22, 23, 27, 28, 29, 30, 31, 36, 37, 38,
      40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    ];

    for (const variant of variants) {
      const { result, written } = await runAgent({
        frames: [textFrame("answer"), execRequestFrame(variant)],
        stream: true,
      });

      const body = await result.response.text();
      expect(body, `variant ${variant} must not fail the turn`).not.toContain("unsupported IDE tool");
      expect(written.length, `variant ${variant} must be answered`).toBe(2);
      const content = parseSSE(body).map((e) => e.choices?.[0]?.delta?.content || "").join("");
      expect(content, `variant ${variant} must keep the streamed text`).toBe("answer");
    }
  });

  it("degrades an unrecognised exec variant instead of failing the turn", async () => {
    // Field 99 is not in the descriptor at all. Protocol drift must not turn a
    // turn that already streamed a full answer into an API error.
    const { result, written } = await runAgent({
      frames: [textFrame("answer"), execRequestFrame(99)],
      stream: true,
    });

    const body = await result.response.text();
    expect(body).not.toContain("unsupported IDE tool");
    expect(written.length).toBe(2);
    const content = parseSSE(body).map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("answer");
  });

  it("keeps the pi_* and mini_swe renumbering out of the way", async () => {
    // pi_read_args is field 45 on the server side but field 46 on the client side,
    // so the map is not an identity and a copy-pasted offset would go unnoticed.
    const { written } = await runAgent({
      frames: [textFrame("answer"), execRequestFrame(45)],
      stream: true,
    });

    const fields = protobufFieldNumbers(Buffer.from(written[1]));
    expect(fields).toContain(46);
    expect(fields).not.toContain(45);
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

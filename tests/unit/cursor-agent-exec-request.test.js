import { describe, it, expect } from "vitest";

import { CursorExecutor, resolveCursorAgentModel } from "../../open-sse/executors/cursor.js";
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

async function runAgent({ frames, stream }) {
  const executor = new CursorExecutor();
  const written = stubAgentSession(executor, frames);
  const result = await executor.executeAgent({
    model: "gpt-5.2",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream,
    credentials,
  });
  return { result, written };
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
      frames: [execRequestFrame(11)],
      stream: false,
    });

    expect(result.response.status).not.toBe(200);
    const payload = await result.response.json();
    expect(payload.error.message).toContain("unsupported IDE tool");
  });

  it("acks KV blob set/get without treating it as assistant text", async () => {
    const blobId = Buffer.from("kv-blob-id");
    const blobData = Buffer.from("not-visible-payload");
    const setArgs = Buffer.concat([
      Buffer.from(encodeField(1, LEN, blobId)),
      Buffer.from(encodeField(2, LEN, blobData)),
    ]);
    const setKv = Buffer.concat([
      Buffer.from(encodeField(1, 0, 7)),
      Buffer.from(encodeField(3, LEN, setArgs)),
    ]);
    const kvFrame = Buffer.from(wrapConnectRPCFrame(encodeField(4, LEN, setKv)));

    const { result, written } = await runAgent({
      frames: [kvFrame, textFrame("pong")],
      stream: true,
    });

    expect(written.length).toBe(2); // run frame + KV ack
    const events = parseSSE(await result.response.text());
    const content = events.map((e) => e.choices?.[0]?.delta?.content || "").join("");
    expect(content).toBe("pong");
  });

  it("passes the connection proxy into AgentService Run", async () => {
    const executor = new CursorExecutor();
    let seenProxy = undefined;
    stubAgentSession(executor, [textFrame("pong")]);
    const original = executor.openAgentHttp2Stream;
    executor.openAgentHttp2Stream = (url, headers, signal, proxyOptions) => {
      seenProxy = proxyOptions;
      return original(url, headers, signal, proxyOptions);
    };

    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:10808",
    };
    await executor.execute({
      model: "claude-fable-5",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
      proxyOptions,
    });

    expect(seenProxy).toEqual(proxyOptions);
  });

  it("maps Fable *-fast slugs to the catalog id in RequestedModel.model_id", async () => {
    expect(resolveCursorAgentModel("claude-fable-5-thinking-max-fast")).toBe("claude-fable-5-thinking-max");
    expect(resolveCursorAgentModel("claude-fable-5-max-fast")).toBe("claude-fable-5-max");
    expect(resolveCursorAgentModel("claude-opus-5-thinking-max-fast")).toBe("claude-opus-5-thinking-max-fast");
    expect(resolveCursorAgentModel("gpt-5.6-sol-max-fast")).toBe("gpt-5.6-sol-max-fast");

    const executor = new CursorExecutor();
    const written = stubAgentSession(executor, [textFrame("pong")]);
    await executor.executeAgent({
      model: "claude-fable-5-thinking-max-fast",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
    });

    const run = decodeMessage(decodeMessage(written[0].subarray(5)).get(1)[0].value);
    const requested = decodeMessage(run.get(9)[0].value);
    expect(Buffer.from(requested.get(1)[0].value).toString("utf8")).toBe("claude-fable-5-thinking-max");
  });
});

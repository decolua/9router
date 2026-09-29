import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { applyFingerprintTools, takeFingerprintMetadata, OPENCODE_GUARD_LIMITS } from "../../open-sse/utils/opencodeFingerprint.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();

function fingerprintMetadata(names = []) {
  const body = {
    tools: names.map((name) => ({ type: "function", function: { name } })),
  };
  applyFingerprintTools(body, false);
  return takeFingerprintMetadata(body);
}

async function readStream(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

async function transform(input, metadata, options = {}) {
  const upstream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const failures = [];
  const output = await readStream(upstream.pipeThrough(createSSEStream({
    mode: options.mode || "passthrough",
    targetFormat: options.targetFormat || FORMATS.OPENAI,
    sourceFormat: options.sourceFormat || FORMATS.OPENAI,
    provider: "opencode",
    toolNameMap: metadata,
    onStreamFailure: (failure) => failures.push(failure),
  })));
  return { output, failures };
}

function chatTool(name, finishReason = null) {
  return `data: ${JSON.stringify({
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, function: { name } }] },
      finish_reason: finishReason,
    }],
  })}\n\n`;
}

describe("OpenCode guarded live SSE streams", () => {
  it("passes a legitimate caller Bash tool through unchanged", async () => {
    const metadata = fingerprintMetadata(["Bash"]);
    const { output, failures } = await transform(`${chatTool("bash", "tool_calls")}data: [DONE]\n\n`, metadata);

    expect(output).toContain('"name":"Bash"');
    expect(output).not.toContain('"error"');
    expect(failures).toEqual([]);
  });

  it("rejects an injected Chat tool with one error frame before DONE", async () => {
    const { output, failures } = await transform(`${chatTool("grep", "tool_calls")}data: [DONE]\n\n`, fingerprintMetadata());

    expect(output).toContain('"code":"upstream_undeclared_tool"');
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(output).not.toContain('"name":"grep"');
    expect(failures).toEqual([expect.objectContaining({ status: 502, origin: "processing", code: "upstream_undeclared_tool" })]);
  });

  it("holds fragmented caller grep_project output until its identity resolves", async () => {
    const metadata = fingerprintMetadata(["grep_project"]);
    const first = chatTool("grep");
    const second = chatTool("_project", "tool_calls");
    const { output, failures } = await transform(`${first}${second}data: [DONE]\n\n`, metadata);

    expect(output).toContain('"name":"grep_project"');
    expect(output).not.toContain('"error"');
    expect(failures).toEqual([]);
  });

  it("emits response.failed instead of response.completed for injected Responses output", async () => {
    const metadata = fingerprintMetadata();
    const input = [
      "event: response.output_item.added",
      `data: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", name: "grep" } })}`,
      "",
    ].join("\n");
    const { output, failures } = await transform(input, metadata, {
      mode: "translate",
      targetFormat: FORMATS.OPENAI_RESPONSES,
      sourceFormat: FORMATS.OPENAI_RESPONSES,
    });

    expect(output).toContain("event: response.failed");
    expect(output).toContain('"code":"upstream_undeclared_tool"');
    expect(output).not.toContain("event: response.completed");
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(failures).toEqual([expect.objectContaining({ status: 502, origin: "processing" })]);
  });

  it("reports a processing failure and never calls request success after a guard rejection", async () => {
    const providerResponse = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`${chatTool("grep", "tool_calls")}data: [DONE]\n\n`));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const onRequestSuccess = vi.fn();
    const onResilienceEvent = vi.fn();
    const streamController = createStreamController({ provider: "opencode", model: "test" });

    const result = await handleStreamingResponse({
      providerResponse,
      provider: "opencode",
      model: "test",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      userAgent: "test-client",
      body: {},
      stream: true,
      translatedBody: {},
      requestStartTime: Date.now(),
      connectionId: "connection_1",
      toolNameMap: fingerprintMetadata(),
      streamController,
      onRequestSuccess,
      onResilienceEvent,
    });
    const output = await result.response.text();

    expect(output).toContain('"code":"upstream_undeclared_tool"');
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(onResilienceEvent).toHaveBeenCalledWith("STREAM_FAILED", expect.objectContaining({ origin: "processing" }));
    expect(onResilienceEvent).not.toHaveBeenCalledWith("STREAM_COMPLETED", expect.anything());
  });

  it("fails explicitly with a bounded-buffer code once held tool output exceeds the safety limit", async () => {
    const metadata = fingerprintMetadata(["grep_project"]);
    // Held fragment name grows on each event without ever resolving. Once the
    // running rename-map lookup key exceeds MAX_NAME_BYTES, the guard must
    // reject with upstream_tool_name_limit rather than silently truncating or
    // buffering forever.
    const oversizedFragment = "g".repeat(OPENCODE_GUARD_LIMITS.MAX_NAME_BYTES + 1);
    const input = `${chatTool(oversizedFragment)}data: [DONE]\n\n`;
    const { output, failures } = await transform(input, metadata);

    expect(output).toContain('"code":"upstream_tool_name_limit"');
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(failures).toEqual([expect.objectContaining({ status: 502, origin: "processing", code: "upstream_tool_name_limit" })]);
  });

  it("replays an unchanged guarded record byte-for-byte, preserving comments, multiple data lines, and CRLF terminators", async () => {
    // Uses a tool name outside the fingerprint quartet so restoreToolNames finds
    // no rename entry and returns the same object reference (rawChanged=false).
    // A quartet name like "bash" would trigger a rename, which forces
    // serializeRecord's single-line re-serialization instead of the verbatim
    // replay this test is meant to prove.
    const metadata = fingerprintMetadata(["Bash"]);
    const payload = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "custom_project_tool" } }] }, finish_reason: "tool_calls" }] };
    const serialized = JSON.stringify(payload);
    const half = Math.floor(serialized.length / 2);
    const record = [
      ": keep-alive comment",
      `data: ${serialized.slice(0, half)}`,
      `data: ${serialized.slice(half)}`,
      "",
      "",
    ].join("\r\n");
    const { output, failures } = await transform(`${record}data: [DONE]\r\n\r\n`, metadata);

    expect(output).toContain(": keep-alive comment\r\n");
    expect(output).toContain(`data: ${serialized.slice(0, half)}\r\n`);
    expect(output).toContain(`data: ${serialized.slice(half)}\r\n`);
    expect(output).toContain('"name":"custom_project_tool"');
    expect(failures).toEqual([]);
  });

  it("commits STREAM_FAILED before a concurrent client disconnect can record CLIENT_ABORTED", async () => {
    const providerResponse = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chatTool("grep", "tool_calls")));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const onResilienceEvent = vi.fn();
    const streamController = createStreamController({ provider: "opencode", model: "test" });

    const result = await handleStreamingResponse({
      providerResponse,
      provider: "opencode",
      model: "test",
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      userAgent: "test-client",
      body: {},
      stream: true,
      translatedBody: {},
      requestStartTime: Date.now(),
      connectionId: "connection_2",
      toolNameMap: fingerprintMetadata(),
      streamController,
      onRequestSuccess: vi.fn(),
      onResilienceEvent,
    });

    // Read the guard-rejection bytes through so captureSemanticFailure/onGuardFailure
    // settle STREAM_FAILED, then cancel the client-facing body — the real
    // disconnect path (createDisconnectAwareStream's cancel() -> the wrapped
    // controller pipeWithDisconnect builds around streamController, not
    // streamController itself) — to prove settlement already won the race.
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel("client_closed");

    expect(onResilienceEvent).toHaveBeenCalledWith("STREAM_FAILED", expect.objectContaining({ origin: "processing" }));
    expect(onResilienceEvent).not.toHaveBeenCalledWith("CLIENT_ABORTED", expect.anything());
  });
});

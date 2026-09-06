// Regression tests for claude→claude OAuth tool-cloak decloak ROUTING.
//
// The original decloak fix put decloakStreamChunk() into translateResponse()'s
// same-format branch, but the runtime never called it: buildTransformStream()
// routed same-format streams to the raw passthrough stream (which forwards
// bytes without ever consulting translateResponse), so OAuth-cloaked tool
// names (*_ide) leaked to claude-format clients and every tool call was
// rejected as unknown. These tests pin the routing itself:
//   1. same-format + toolNameMap → translate stream → streamed tool_use names
//      are restored, and claude framing (event: + data: pairs) is re-emitted
//   2. same-format without a map → raw passthrough stays byte-exact (cloaked
//      or foreign names pass through untouched — no cloak, nothing to restore)
import { describe, it, expect } from "vitest";
import { buildTransformStream } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";

const CLOAKED = "get_weather" + CLAUDE_TOOL_SUFFIX; // "get_weather_ide"

const claudeEvent = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

const toolUseStart = (name) => claudeEvent({
  type: "content_block_start",
  index: 1,
  content_block: { type: "tool_use", id: "toolu_01XYZ", name, input: {} },
});

const messageStart = claudeEvent({ type: "message_start", message: { id: "msg_01X", usage: { input_tokens: 5, output_tokens: 0 } } });
const messageStop = claudeEvent({ type: "message_stop" });

/**
 * Push `input` through the chosen transform stream and collect the decoded
 * output WITHOUT closing the writer (close would run flush → usage-log side
 * effects inappropriate for a unit test).
 */
async function pump(transform, input, expectedChunks) {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const decoder = new TextDecoder();
  const out = [];
  const pumpDone = (async () => {
    for (let i = 0; i < expectedChunks; i++) {
      const { value } = await reader.read();
      if (value) out.push(decoder.decode(value));
    }
  })();
  await writer.write(new TextEncoder().encode(input));
  await pumpDone;
  writer.releaseLock();
  reader.releaseLock();
  return out;
}

describe("buildTransformStream claude→claude routing (OAuth tool cloak)", () => {
  const baseArgs = {
    provider: "claude",
    sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.CLAUDE,
    userAgent: "vitest",
    reqLogger: null,
    model: "claude-haiku-4-5-20251001",
    connectionId: null,
    body: null,
    onStreamComplete: null,
    apiKey: null,
    customToolNames: null,
  };

  it("routes cloaked same-format streams through the translate stream and restores tool names", async () => {
    const toolNameMap = new Map([[CLOAKED, "get_weather"]]);
    const stream = buildTransformStream({ ...baseArgs, toolNameMap });
    // 3 input events → translate mode re-emits 3 chunks (event: + data: framing)
    const out = await pump(stream, messageStart + toolUseStart(CLOAKED) + messageStop, 3);
    const text = out.join("");

    // Tool name restored on the streamed tool_use content_block_start
    expect(text).toContain('"name":"get_weather"');
    expect(text).not.toContain(CLOAKED);

    // Claude framing preserved (formatSSE re-emits event: lines from data.type)
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_start");
    expect(text).toContain("event: message_stop");
  });

  it("keeps the raw passthrough stream for same-format requests without a cloak map", async () => {
    const stream = buildTransformStream({ ...baseArgs, toolNameMap: null });
    // Passthrough forwards the data line (no decloak — nothing was cloaked)
    const out = await pump(stream, toolUseStart(CLOAKED), 1);
    const text = out.join("");
    // Documents the routing boundary: without a map the name passes through
    // untouched (providers that don't cloak never rename client tools).
    expect(text).toContain(CLOAKED);
  });

  it("still uses the translate stream whenever formats differ (pre-existing behavior)", () => {
    const stream = buildTransformStream({
      ...baseArgs,
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.CLAUDE,
      toolNameMap: null,
    });
    // Not asserting on chunk contents here (openai emission), only that a
    // transform stream (readable/writable) is returned for cross-format.
    expect(stream).toBeTruthy();
    expect(stream.readable).toBeTruthy();
    expect(stream.writable).toBeTruthy();
  });
});

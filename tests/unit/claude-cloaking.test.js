/**
 * Regression: Claude passthrough streaming leaked cloaked tool names to clients.
 *
 * Symptom seen by Claude Code / OpenClaw users:
 *   "I can't use the tool 'exec_ide' here because it isn't available.
 *    I need to stop retrying it and answer without that tool."
 *   (Also seen as web_search_ide, read_ide, write_ide, etc.)
 *
 * Why it happened: 9router cloaks client tool names with a _ide suffix on the
 * request path (anti-ban against the upstream provider), then is supposed to
 * strip the suffix on the response path. For Claude /v1/messages passthrough,
 * the strip never ran — upstream `content_block_start` events containing
 * `"name":"read_ide"` reached the client unchanged, and the model's own tool
 * registry has no `read_ide`, so it refused to invoke them.
 *
 * Contract under test: given a `toolNameMap` of cloaked → original names, the
 * SSE pipeline MUST NOT emit any cloaked name to the client — regardless of
 * whether the event is processed on the transform path or stranded in the
 * flush buffer at end-of-stream.
 */

import { describe, it, expect, vi } from "vitest";

// Stub the usage DB so stream.js can load without touching sqlite.
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(),
}));

const { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } = await import("open-sse/utils/stream.js");
const { FORMATS } = await import("open-sse/translator/formats.js");
const { decloakToolNames } = await import("open-sse/utils/claudeCloaking.js");

async function runStream(stream, inputs) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  const chunks = [];
  const readAll = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }
  })();

  for (const input of inputs) await writer.write(encoder.encode(input));
  await writer.close();
  await readAll;

  return chunks.join("");
}

describe("Claude passthrough cloak/decloak symmetry", () => {
  it("does not leak *_ide tool names when a content_block_start lands in the flush buffer", async () => {
    // Map cloaked → original. This mirrors what cloakClaudeTools() builds.
    const toolNameMap = new Map([
      ["read_ide", "read"],
      ["exec_ide", "exec"],
      ["web_search_ide", "web_search"],
    ]);

    // Upstream SSE: event: line is newline-terminated, but the data: line is NOT.
    // The data: line therefore sits in the transform's internal buffer until
    // the writer closes, at which point the flush handler must decloak it.
    const event =
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,' +
      '"content_block":{"type":"tool_use","id":"toolu_01","name":"read_ide","input":{}}}';

    // Public wrapper signature:
    //   createPassthroughStreamWithLogger(
    //     provider, reqLogger, model, connectionId, body,
    //     onStreamComplete, apiKey, sourceFormat, toolNameMap
    //   )
    // sourceFormat + toolNameMap are the new tail params — the fix must
    // thread them through so passthrough mode can decloak Claude events.
    const stream = createPassthroughStreamWithLogger(
      null, null, null, null, null, null, null,
      FORMATS.CLAUDE, toolNameMap,
    );

    const output = await runStream(stream, [event]);

    // Invariant: no cloaked name ever reaches the client.
    expect(output).not.toMatch(/_ide/);
    // And the real tool name IS present.
    expect(output).toContain('"name":"read"');
  });

  it("does not leak *_ide tool names when translating Claude stream to OpenAI client", async () => {
    // Scenario: OpenAI client → Claude provider. Client sent OpenAI-format
    // tools[], 9router translated to Claude request and cloaked "read" →
    // "read_ide" on the wire. Claude's SSE response carries "read_ide" in
    // tool_use events. The translator converts those to OpenAI tool_calls
    // — but if decloak runs at emit() time (output side), the Claude walker
    // never matches the post-translation OpenAI shape (`function.name`),
    // so the cloaked name reaches the client anyway.
    //
    // Invariant: decloak must happen on the INPUT side (raw Claude SSE
    // lines) before translation, so the walker's Claude-shape-only
    // knowledge is sufficient regardless of client format.
    const toolNameMap = new Map([["read_ide", "read"]]);

    // Full, newline-terminated Claude SSE sequence for a single tool_use.
    // No flush-buffer contribution — this test targets the transform path,
    // not the flush regression test 1 already covers.
    const input =
      "event: message_start\n" +
      'data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-3","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n' +
      "\n" +
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"read_ide","input":{}}}\n' +
      "\n" +
      "event: content_block_delta\n" +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"/tmp\\"}"}}\n' +
      "\n" +
      "event: content_block_stop\n" +
      'data: {"type":"content_block_stop","index":0}\n' +
      "\n" +
      "event: message_delta\n" +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":5}}\n' +
      "\n" +
      "event: message_stop\n" +
      'data: {"type":"message_stop"}\n' +
      "\n";

    // createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, ...)
    const stream = createSSETransformStreamWithLogger(
      FORMATS.CLAUDE, FORMATS.OPENAI, null, null, toolNameMap,
    );

    const output = await runStream(stream, [input]);

    // Invariant: no cloaked name ever reaches the client.
    expect(output).not.toMatch(/_ide/);
    // And the real tool name IS present in the translated OpenAI output.
    expect(output).toContain('"name":"read"');
    // The tool_use block itself survives translation (guards against a
    // trivially-wrong impl that simply deletes the cloaked block).
    expect(output).toContain("toolu_01");
  });

  it("handles cloaked names split across chunk boundaries (real TCP framing)", async () => {
    // Real network framing doesn't respect SSE line boundaries. Bytes for
    // a single JSON line can arrive split anywhere — including inside the
    // cloaked name itself. The design invariant is: decloak runs on
    // COMPLETE lines only (after buffer.split("\n")), so partials in the
    // buffer are benign. A future refactor that moved decloak to raw
    // chunk text (pre-buffering) would regress on this shape — this test
    // pins that invariant.
    const toolNameMap = new Map([["read_ide", "read"]]);

    const fullInput =
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_42","name":"read_ide","input":{}}}\n' +
      "\n";

    // Split the input at an awkward point — mid-cloaked-name — across chunks.
    const splitAt = fullInput.indexOf("read_i") + 4; // between "read" and "_ide"
    const chunks = [fullInput.slice(0, splitAt), fullInput.slice(splitAt)];

    const stream = createPassthroughStreamWithLogger(
      null, null, null, null, null, null, null,
      FORMATS.CLAUDE, toolNameMap,
    );

    const output = await runStream(stream, chunks);

    expect(output).not.toMatch(/_ide/);
    expect(output).toContain('"name":"read"');
    expect(output).toContain("toolu_42");
  });

  it("decloaks translate-mode flush buffer (Claude provider → OpenAI client, no trailing newline)", async () => {
    // Mirror of test 1 but in translate mode: the final data: line is not
    // newline-terminated, so it sits in the transform's internal buffer
    // until writer.close(). The translate-branch flush must decloak that
    // leftover buffer before running it through parseSSELine/translator.
    const toolNameMap = new Map([["exec_ide", "exec"]]);

    const event =
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,' +
      '"content_block":{"type":"tool_use","id":"toolu_99","name":"exec_ide","input":{}}}';

    const stream = createSSETransformStreamWithLogger(
      FORMATS.CLAUDE, FORMATS.OPENAI, null, null, toolNameMap,
    );

    const output = await runStream(stream, [event]);

    expect(output).not.toMatch(/_ide/);
  });

  it("decloaks with CRLF line endings (trimStart left trailing \\r, breaking JSON.parse)", async () => {
    // SSE spec allows \r\n, \r, or \n. buffer.split("\n") leaves a
    // trailing \r on each line when upstream uses CRLF. A payload like
    // `{"name":"read_ide"}\r` is not valid JSON, so trimStart()-only
    // handling silently falls into the catch path and returns the original
    // cloaked line. Full trim() is required.
    const toolNameMap = new Map([["read_ide", "read"]]);

    const input =
      "event: content_block_start\r\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_crlf","name":"read_ide","input":{}}}\r\n' +
      "\r\n";

    const stream = createPassthroughStreamWithLogger(
      null, null, null, null, null, null, null,
      FORMATS.CLAUDE, toolNameMap,
    );

    const output = await runStream(stream, [input]);

    expect(output).not.toMatch(/_ide/);
    expect(output).toContain('"name":"read"');
  });

  it("decloaks raw JSON stream chunks emitted by the live Claude executor", async () => {
    // The live Anthropic executor can hand the stream layer a bare JSON line
    // rather than an SSE `data:` line. That path was the reason the browser
    // test still leaked exec_ide after the map-based SSE fix.
    const event =
      '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_raw","name":"exec_ide","input":{}}}\n';

    const stream = createPassthroughStreamWithLogger(
      "claude", null, null, null, null, null, null,
      FORMATS.CLAUDE, null,
    );

    const output = await runStream(stream, [event]);

    expect(output).not.toMatch(/_ide/);
    expect(output).toContain('"name":"exec"');
    expect(output).toContain("toolu_raw");
  });

  it("decloaks Claude-provider streams even when toolNameMap is missing at runtime", async () => {
    // Live /v1/messages exercised a path where the provider SSE stream still
    // contained Claude-cloaked names, but the map-based guard did not fire in
    // the running server. Provider === "claude" is sufficient evidence that
    // a client-bound Claude tool_use name ending in the configured cloak
    // suffix must be restored before emit.
    const event =
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_live","name":"exec_ide","input":{}}}\n' +
      "\n";

    const stream = createPassthroughStreamWithLogger(
      "claude", null, null, null, null, null, null,
      FORMATS.CLAUDE, null,
    );

    const output = await runStream(stream, [event]);

    expect(output).not.toMatch(/_ide/);
    expect(output).toContain('"name":"exec"');
    expect(output).toContain("toolu_live");
  });

  it("leaves non-cloaked tool names unchanged when toolNameMap is empty", async () => {
    // The suffix fallback should be narrow: even when no map is available,
    // ordinary tool names that do not carry the Claude cloak suffix must pass
    // through exactly as upstream sent them.
    const emptyMap = new Map();

    const event =
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"some_tool","input":{}}}\n' +
      "\n";

    const stream = createPassthroughStreamWithLogger(
      null, null, null, null, null, null, null,
      FORMATS.CLAUDE, emptyMap,
    );

    const output = await runStream(stream, [event]);

    // Nothing to rewrite — name passes through exactly as upstream sent.
    expect(output).toContain('"name":"some_tool"');
  });

  it("does NOT strip _ide suffix on non-Claude providers (real tool 'analyze_ide' survives)", async () => {
    // Defense-in-depth check on the suffix-fallback gate: stripClaudeToolSuffixes
    // would happily turn a legitimate tool named "analyze_ide" into "analyze" if
    // run unconditionally. The fallback must only fire when bytes are known
    // Claude-shape (provider === "claude"). On any other provider, an organic
    // _ide-suffixed name must pass through untouched even if the map is empty.
    const event =
      "event: content_block_start\n" +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_org","name":"analyze_ide","input":{}}}\n' +
      "\n";

    const stream = createPassthroughStreamWithLogger(
      "openai", null, null, null, null, null, null,
      FORMATS.OPENAI, null,
    );

    const output = await runStream(stream, [event]);

    // The genuine tool name must survive — no mangling on non-Claude providers.
    expect(output).toContain('"name":"analyze_ide"');
  });

  it("terminates the flush buffer line so it doesn't run into the [DONE] sentinel", async () => {
    // Regression: passthrough flush emitted the leftover buffer with no
    // trailing newline, producing wire bytes like "data: {...}data: [DONE]\n\n".
    // Strict SSE parsers treat that as a single line and drop the prior event.
    // Invariant: the flushed line MUST end with at least one "\n" before
    // [DONE] is emitted.
    const toolNameMap = new Map([["read_ide", "read"]]);

    // Final data: line is NOT newline-terminated, so it lives in the flush
    // buffer until close(). After close, [DONE] is appended.
    const event =
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_term","name":"read_ide","input":{}}}';

    const stream = createPassthroughStreamWithLogger(
      "claude", null, null, null, null, null, null,
      FORMATS.CLAUDE, toolNameMap,
    );

    const output = await runStream(stream, [event]);

    // No glued line: there must be a newline between the data payload and
    // the [DONE] sentinel. The pathological wire form is caught by checking
    // that "}data: [DONE]" never appears.
    expect(output).not.toMatch(/}data: \[DONE\]/);
    expect(output).toContain('"name":"read"');
    expect(output).toContain("data: [DONE]\n\n");
  });

  it("decloaks non-streaming Claude response bodies (content[] with tool_use)", () => {
    // Non-streaming /v1/messages returns a full message object with content[].
    // Same cloak→decloak invariant must hold: nonStreamingHandler.js passes
    // this body through decloakToolNames before the Response is sent, so the
    // single walker has to cover this shape too.
    const toolNameMap = new Map([
      ["read_ide", "read"],
      ["exec_ide", "exec"],
    ]);

    const body = {
      id: "msg_01",
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: "I'll look at the file." },
        { type: "tool_use", id: "toolu_01", name: "read_ide", input: { path: "/tmp/x" } },
        { type: "tool_use", id: "toolu_02", name: "exec_ide", input: { cmd: "ls" } },
      ],
      stop_reason: "tool_use",
    };

    const result = decloakToolNames(body, toolNameMap);

    expect(result.content[1].name).toBe("read");
    expect(result.content[2].name).toBe("exec");
    expect(JSON.stringify(result)).not.toMatch(/_ide/);
  });
});

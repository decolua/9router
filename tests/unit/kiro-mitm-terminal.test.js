import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Load the CommonJS MITM handler and reach its NON-exported internals
// (`convertOpenAIToKiro`, `emitFinish`, `initKiroState`).
//
// The module currently only does `module.exports = { intercept }` (named exports
// for the internals are added in task 3 of this bugfix spec — NOT here). For this
// exploration test we load the source text, append the internals to the exports,
// and compile it with the ORIGINAL filename so its relative `require(...)` calls
// (e.g. "../logger", "./base") still resolve. No source file is modified on disk.
// ─────────────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = resolve(__dirname, "../../src/mitm/handlers/kiro.js");

function loadKiroInternals() {
  const original = readFileSync(HANDLER_PATH, "utf8");
  // Re-export the internals we need without touching the real file on disk.
  const patched = original.replace(
    /module\.exports\s*=\s*\{[^}]*\};?/,
    "module.exports = { intercept, convertOpenAIToKiro, emitFinish, initKiroState, isBinaryEventStream };"
  );
  if (patched === original) {
    throw new Error("Could not locate module.exports in kiro.js to patch for test access");
  }

  // Compile the patched source under the real filename so relative requires
  // (../logger, ./base, etc.) resolve exactly as they do in production.
  const mod = new Module(HANDLER_PATH, null);
  mod.filename = HANDLER_PATH;
  mod.paths = Module._nodeModulePaths(dirname(HANDLER_PATH));
  mod._compile(patched, HANDLER_PATH);
  return mod.exports;
}

const { convertOpenAIToKiro, initKiroState, isBinaryEventStream, intercept } =
  loadKiroInternals();

// ─────────────────────────────────────────────────────────────────────────────
// Local AWS EventStream frame decoder.
// Mirrors the encoder in src/mitm/handlers/kiro.js and the decoder shape used by
// tests/unit/kiro-terminal-integrity.test.js. Parses the frame prelude, walks the
// header block to pull `:event-type`, and JSON-parses the payload.
// ─────────────────────────────────────────────────────────────────────────────
function decodeFrame(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const totalLen = view.getUint32(0, false);
  const headersLen = view.getUint32(4, false);
  // prelude = 12 bytes (totalLen + headersLen + preludeCRC)
  let offset = 12;
  const headersEnd = 12 + headersLen;
  const headers = {};
  const decoder = new TextDecoder();

  while (offset < headersEnd) {
    const nameLen = buf[offset];
    offset += 1;
    const name = decoder.decode(buf.subarray(offset, offset + nameLen));
    offset += nameLen;
    const type = buf[offset];
    offset += 1;
    // Only string headers (type 7) are used by the encoder.
    if (type === 7) {
      const valueLen = view.getUint16(offset, false);
      offset += 2;
      const value = decoder.decode(buf.subarray(offset, offset + valueLen));
      offset += valueLen;
      headers[name] = value;
    } else {
      throw new Error(`Unexpected header type ${type} for ${name}`);
    }
  }

  const payloadBytes = buf.subarray(headersEnd, totalLen - 4);
  let payload = null;
  const payloadText = decoder.decode(payloadBytes);
  if (payloadText.length > 0) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      payload = payloadText;
    }
  }

  return {
    eventType: headers[":event-type"],
    messageType: headers[":message-type"],
    contentType: headers[":content-type"],
    payload,
    byteLength: totalLen,
  };
}

/** Decode a possibly-concatenated buffer of one or more EventStream frames. */
function decodeFrames(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const frames = [];
  let offset = 0;
  while (offset < buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset, buf.length - offset);
    const totalLen = view.getUint32(0, false);
    frames.push(decodeFrame(buf.subarray(offset, offset + totalLen)));
    offset += totalLen;
  }
  return frames;
}

/**
 * Feed a list of OpenAI SSE chunks through convertOpenAIToKiro, then flush,
 * and return every decoded EventStream frame in emission order.
 */
function runStream(chunks) {
  const state = initKiroState("kr/claude-opus-4.8");
  const emitted = [];

  const collect = (result) => {
    if (result == null) return;
    const list = Array.isArray(result) ? result : [result];
    for (const frame of list) emitted.push(...decodeFrames(frame));
  };

  for (const chunk of chunks) {
    collect(convertOpenAIToKiro(chunk, state));
  }
  // Flush (null signals stream end, mirrors pipeTransformedEventStream)
  collect(convertOpenAIToKiro(null, state));

  return emitted;
}

// Real Kiro Runtime terminal-frame types that carry an authoritative stopReason.
const TERMINAL_TYPES = new Set(["metadataEvent", "messageStopEvent"]);

function terminalStopReason(frames) {
  // The authoritative terminator is a metadataEvent/messageStopEvent that carries
  // a stopReason payload.
  const terminal = frames.find(
    (f) => TERMINAL_TYPES.has(f.eventType) && f.payload && f.payload.stopReason
  );
  return terminal ? terminal.payload.stopReason : null;
}

describe("Kiro MITM terminal frame integrity (bug condition exploration)", () => {
  // ── Property 1 (Bug Condition): text-only turn ──────────────────────────────
  it("text-only turn ends with stopReason 'END_TURN' and no usageEvent", () => {
    const frames = runStream([
      { model: "kr/claude-opus-4.8", choices: [{ delta: { role: "assistant" } }] },
      { model: "kr/claude-opus-4.8", choices: [{ delta: { content: "selamat pagi " } }] },
      { model: "kr/claude-opus-4.8", choices: [{ delta: { content: "ada yang bisa dibantu?" } }] },
      { model: "kr/claude-opus-4.8", choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);

    const eventTypes = frames.map((f) => f.eventType);
    // Diagnostic: surface the exact terminal shape as a counterexample on failure.
    // eslint-disable-next-line no-console
    console.log("[text turn] emitted frames:", JSON.stringify(frames, null, 2));

    // A real Kiro terminal frame must carry an authoritative stopReason in UPPERCASE.
    expect(terminalStopReason(frames)).toBe("END_TURN");
    // metadataEvent must be the terminal frame type
    expect(eventTypes).toContain("metadataEvent");
    // usageEvent is NOT a real Kiro Runtime event type — it must never appear.
    expect(eventTypes).not.toContain("usageEvent");
  });

  // ── Property 1 (Bug Condition): tool-call turn ──────────────────────────────
  it("tool-call turn ends with stopReason 'TOOL_USE' and no usageEvent", () => {
    const frames = runStream([
      { model: "kr/claude-opus-4.8", choices: [{ delta: { role: "assistant" } }] },
      {
        model: "kr/claude-opus-4.8",
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "read_file", arguments: "" } },
              ],
            },
          },
        ],
      },
      {
        model: "kr/claude-opus-4.8",
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"path":"a.txt"}' } }],
            },
          },
        ],
      },
      { model: "kr/claude-opus-4.8", choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);

    const eventTypes = frames.map((f) => f.eventType);
    // eslint-disable-next-line no-console
    console.log("[tool turn] emitted frames:", JSON.stringify(frames, null, 2));

    // Preserve the tool frames (init, fragment, stop:true) — sanity check.
    expect(eventTypes.filter((t) => t === "toolUseEvent").length).toBeGreaterThanOrEqual(2);
    // A real Kiro tool-call turn terminates with stopReason: "TOOL_USE".
    expect(terminalStopReason(frames)).toBe("TOOL_USE");
    expect(eventTypes).toContain("metadataEvent");
    expect(eventTypes).not.toContain("usageEvent");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 2 — Preservation property tests (Property 2).
//
// Methodology: observation-first. These run against the UNFIXED source loaded
// above and record the actual non-terminal frame subsequences the current code
// emits, then assert those subsequences hold across a generated input domain.
// They MUST PASS on unfixed code — they lock the baseline the Task 3 fix must
// preserve. Only the terminal frames (messageStopEvent / usageEvent) are allowed
// to change in the fix; every other frame must remain byte-identical.
//
// fast-check is NOT a dependency of the tests/ package (see tests/package.json),
// so the "property" is expressed as an explicit generated loop over tool counts,
// mixed text+reasoning+tool streams, and varied content rather than fc.assert.
// ═════════════════════════════════════════════════════════════════════════════

// Frame types the Task 3 fix is permitted to change. Everything else is a
// "non-terminal" frame and must be preserved byte-for-byte.
const TERMINAL_MUTABLE_TYPES = new Set([
  "messageStopEvent",
  "metadataEvent",
  "contextUsageEvent",
  "meteringEvent",
  "usageEvent"
]);

/** Run a stream and return the raw concatenated bytes (all frames, in order). */
function runStreamBytes(chunks, modelId = "kr/claude-opus-4.8") {
  const state = initKiroState(modelId);
  const parts = [];
  const collect = (result) => {
    if (result == null) return;
    const list = Array.isArray(result) ? result : [result];
    for (const frame of list) parts.push(Buffer.from(frame));
  };
  for (const chunk of chunks) collect(convertOpenAIToKiro(chunk, state));
  collect(convertOpenAIToKiro(null, state));
  return Buffer.concat(parts);
}

/** Decode, then drop trailing terminal frames the fix is allowed to mutate. */
function nonTerminalFrames(chunks, modelId) {
  return decodeFrames(runStreamBytes(chunks, modelId)).filter(
    (f) => !TERMINAL_MUTABLE_TYPES.has(f.eventType)
  );
}

// ─── Deterministic generators (no fast-check) ────────────────────────────────

function textChunk(content) {
  return { model: "kr/claude-opus-4.8", choices: [{ delta: { content } }] };
}
function reasoningChunk(content) {
  return { model: "kr/claude-opus-4.8", choices: [{ delta: { reasoning_content: content } }] };
}
function toolInitChunk(index, id, name) {
  return {
    model: "kr/claude-opus-4.8",
    choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: "" } }] } }],
  };
}
function toolArgChunk(index, args) {
  return {
    model: "kr/claude-opus-4.8",
    choices: [{ delta: { tool_calls: [{ index, function: { arguments: args } }] } }],
  };
}
function finishChunk(reason) {
  return { model: "kr/claude-opus-4.8", choices: [{ delta: {}, finish_reason: reason }] };
}

/** Build a tool-call stream with `n` tools, each with a 2-fragment argument. */
function buildToolStream(n) {
  const chunks = [{ model: "kr/claude-opus-4.8", choices: [{ delta: { role: "assistant" } }] }];
  for (let i = 0; i < n; i++) {
    chunks.push(toolInitChunk(i, `call_${i}`, `tool_${i}`));
    chunks.push(toolArgChunk(i, `{"a":${i},`));
    chunks.push(toolArgChunk(i, `"b":${i}}`));
  }
  chunks.push(finishChunk("tool_calls"));
  return chunks;
}

/** Build a mixed text + reasoning + tool stream. */
function buildMixedStream({ texts = [], reasons = [], tools = 0 } = {}) {
  const chunks = [{ model: "kr/claude-opus-4.8", choices: [{ delta: { role: "assistant" } }] }];
  for (const r of reasons) chunks.push(reasoningChunk(r));
  for (const t of texts) chunks.push(textChunk(t));
  for (let i = 0; i < tools; i++) {
    chunks.push(toolInitChunk(i, `call_${i}`, `tool_${i}`));
    chunks.push(toolArgChunk(i, `{"i":${i}}`));
  }
  chunks.push(finishChunk(tools > 0 ? "tool_calls" : "stop"));
  return chunks;
}

describe("Kiro MITM preservation (Property 2 — non-terminal frames unchanged)", () => {
  // ── Recorded baseline: tool frames (Requirement 3.1) ────────────────────────
  it("records tool subsequence: init (name+id, no input), fragment(s), stop:true per tool", () => {
    const frames = decodeFrames(runStreamBytes(buildToolStream(1)));
    const tool = frames.filter((f) => f.eventType === "toolUseEvent");

    // init: name + toolUseId, NO input
    expect(tool[0].payload).toEqual({ name: "tool_0", toolUseId: "call_0" });
    expect(tool[0].payload).not.toHaveProperty("input");

    // incremental input fragments carry input + name + toolUseId
    expect(tool[1].payload).toEqual({ input: '{"a":0,', name: "tool_0", toolUseId: "call_0" });
    expect(tool[2].payload).toEqual({ input: '"b":0}', name: "tool_0", toolUseId: "call_0" });

    // per-tool stop:true terminator (preserved by the fix)
    const stop = tool[tool.length - 1];
    expect(stop.payload).toEqual({ name: "tool_0", stop: true, toolUseId: "call_0" });

    // Diagnostic record of the exact recorded subsequence.
    // eslint-disable-next-line no-console
    console.log("[recorded tool subseq]", JSON.stringify(tool.map((f) => f.payload)));
  });

  // ── Recorded baseline: reasoning frames (Requirement 3.2) ───────────────────
  it("records reasoningContentEvent for delta.reasoning_content (content + modelId)", () => {
    const frames = decodeFrames(
      runStreamBytes([
        { model: "kr/m", choices: [{ delta: { role: "assistant" } }] },
        reasoningChunk("step one "),
        reasoningChunk("step two"),
        finishChunk("stop"),
      ], "kr/m")
    );
    const reasoning = frames.filter((f) => f.eventType === "reasoningContentEvent");
    expect(reasoning).toHaveLength(2);
    expect(reasoning[0].payload).toEqual({ content: "step one ", modelId: "kr/m" });
    expect(reasoning[1].payload).toEqual({ content: "step two", modelId: "kr/m" });
  });

  it("records reasoningContentEvent for <thinking> and <think> blocks (content + modelId)", () => {
    const think = decodeFrames(
      runStreamBytes([
        textChunk("<thinking>plan the work</thinking>done"),
        finishChunk("stop"),
      ]).valueOf()
    );
    const thinkReason = think.filter((f) => f.eventType === "reasoningContentEvent");
    expect(thinkReason).toHaveLength(1);
    expect(thinkReason[0].payload).toEqual({
      content: "plan the work",
      modelId: "kr/claude-opus-4.8",
    });

    const shortTag = decodeFrames(
      runStreamBytes([textChunk("<think>quick</think>ok"), finishChunk("stop")])
    );
    const shortReason = shortTag.filter((f) => f.eventType === "reasoningContentEvent");
    expect(shortReason).toHaveLength(1);
    expect(shortReason[0].payload).toEqual({ content: "quick", modelId: "kr/claude-opus-4.8" });
  });

  // ── Recorded baseline: initial-response invariant ───────────────────────────
  it("emits exactly one initial-response frame with conversationId '' at stream start", () => {
    const cases = [
      buildMixedStream({ texts: ["hi"] }),
      buildToolStream(2),
      buildMixedStream({ texts: ["a", "b"], reasons: ["r"], tools: 1 }),
    ];
    for (const chunks of cases) {
      const frames = decodeFrames(runStreamBytes(chunks));
      const initials = frames.filter((f) => f.eventType === "initial-response");
      expect(initials).toHaveLength(1);
      // Must be first, empty conversationId, x-amz-json-1.0 content type.
      expect(frames[0].eventType).toBe("initial-response");
      expect(initials[0].payload).toEqual({ conversationId: "" });
      expect(initials[0].contentType).toBe("application/x-amz-json-1.0");
    }
  });

  // ── Binary / non-Kiro passthrough guard (Requirements 3.3, 3.5) ─────────────
  it("isBinaryEventStream returns true for a well-formed AWS EventStream buffer", () => {
    // Minimal well-formed prelude: totalLen(4) headersLen(4) preludeCRC(4) ...
    const totalLen = 64;
    const headersLen = 20;
    const buf = Buffer.alloc(totalLen);
    buf.writeUInt32BE(totalLen, 0);
    buf.writeUInt32BE(headersLen, 4);
    expect(isBinaryEventStream(buf)).toBe(true);

    // A plain JSON body is NOT a binary EventStream.
    const json = Buffer.from(JSON.stringify({ conversationState: {} }), "utf8");
    expect(isBinaryEventStream(json)).toBe(false);
    // Too short to be a frame.
    expect(isBinaryEventStream(Buffer.alloc(4))).toBe(false);
  });

  it("intercept routes a binary EventStream body away from re-translation (never re-encodes)", async () => {
    const totalLen = 128;
    const headersLen = 40;
    const bin = Buffer.alloc(totalLen);
    bin.writeUInt32BE(totalLen, 0);
    bin.writeUInt32BE(headersLen, 4);
    expect(isBinaryEventStream(bin)).toBe(true);

    // intercept catches the binary-guard throw internally and writes a 500 mitm_error
    // WITHOUT ever calling fetchRouter or emitting EventStream frames. We capture the
    // response to confirm it never routed into re-translation.
    let statusCode = null;
    let ended = "";
    const fakeReq = { headers: {} };
    const fakeRes = {
      headersSent: false,
      writeHead(code) { statusCode = code; this.headersSent = true; },
      end(body) { ended = body || ""; },
      write() { throw new Error("intercept must not stream frames for a binary body"); },
    };

    await intercept(fakeReq, fakeRes, bin, "kr/claude-opus-4.8");

    expect(statusCode).toBe(500);
    const parsed = JSON.parse(ended);
    expect(parsed.error.type).toBe("mitm_error");
    expect(parsed.error.handler).toBe("kiro");
    expect(parsed.error.message).toMatch(/Binary EventStream/i);
  });

  // ── Property: non-terminal frames byte-identical across generated inputs ─────
  // The "property" holds when the non-terminal frame subsequence recorded above
  // is reproduced for ANY generated stream. We express it as a generated loop
  // (fast-check is not a tests/ dependency) and re-derive the expected output
  // from the same unfixed code, then assert stability across a second run and
  // that no unexpected frame types leak into the non-terminal region.
  const NON_TERMINAL_TYPES = new Set([
    "initial-response",
    "assistantResponseEvent",
    "reasoningContentEvent",
    "toolUseEvent",
  ]);

  it("property: for any generated stream, non-terminal frames are stable and well-typed", () => {
    const streams = [];
    // Vary tool counts 0..4.
    for (let n = 0; n <= 4; n++) streams.push(buildToolStream(n));
    // Vary mixed text + reasoning + tool content.
    for (let t = 0; t <= 3; t++) {
      for (let r = 0; r <= 2; r++) {
        for (const tools of [0, 1, 2]) {
          streams.push(
            buildMixedStream({
              texts: Array.from({ length: t }, (_, i) => `text-${i} `),
              reasons: Array.from({ length: r }, (_, i) => `reason-${i} `),
              tools,
            })
          );
        }
      }
    }

    for (const chunks of streams) {
      // Determinism: two independent runs of the unfixed code must match exactly.
      const a = nonTerminalFrames(chunks);
      const b = nonTerminalFrames(chunks);
      expect(b).toEqual(a);

      // Every non-terminal frame is one of the known preserved types.
      for (const f of a) {
        expect(NON_TERMINAL_TYPES.has(f.eventType)).toBe(true);
      }

      // initial-response appears exactly once and first.
      expect(a[0].eventType).toBe("initial-response");
      expect(a.filter((f) => f.eventType === "initial-response")).toHaveLength(1);

      // Tool streams: init has no input; a stop:true exists per tool.
      const toolFrames = a.filter((f) => f.eventType === "toolUseEvent");
      const stops = toolFrames.filter((f) => f.payload && f.payload.stop === true);
      const inits = toolFrames.filter(
        (f) => f.payload && !("input" in f.payload) && f.payload.stop !== true
      );
      expect(stops.length).toBe(inits.length);
    }
  });
});

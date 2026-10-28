// End-to-end: a cache-bearing request flows through canonicalizeUsage →
// saveRequestUsage → getUsageStats, proving cached tokens are persisted,
// aggregated, and cost is computed correctly.
//
// The "stream seam" block drives the real production path for a Claude
// upstream behind an OpenAI-format client:
//   claudeToOpenAIResponse (via createSSETransformStreamWithLogger)
//     → finalizeStream → onStreamComplete(usage)
//     → saveUsageStats → canonicalizeUsage → saveRequestUsage → SQLite
// Regression for the double fold: the translator already folded cache into
// prompt_tokens, and canonicalizeUsage folded it a second time (stored
// prompt_tokens=460936 for a 230469-token prompt, halving the cache ratio).
// It also pins the client-visible usage: stream.js must not strip
// prompt_tokens_details.cached_tokens from the OpenAI finish chunk.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let saveUsageStats;
let createSSETransformStreamWithLogger;
let claudeToOpenAIResponse;
let FORMATS;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cached-e2e-"));
  process.env.DATA_DIR = tempDir;
  // A previous suite in this worker may have opened a different DB file.
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  ({ saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js"));
  ({ createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js"));
  ({ claudeToOpenAIResponse } = await import("../../open-sse/translator/response/claude-to-openai.js"));
  ({ FORMATS } = await import("../../open-sse/translator/formats.js"));
});

afterAll(() => {
  // Close the SQLite handle before removing the directory: on Windows an open
  // handle makes rmSync fail with EBUSY and the whole suite is reported failed.
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// --- helpers ---------------------------------------------------------------

// Anthropic's real streaming shape: input + cache in message_start, final
// output only in message_delta.
function claudeEvents({ input, cacheRead = 0, cacheCreation = 0, output, text = "ok" }) {
  const startUsage = { input_tokens: input, output_tokens: 1 };
  if (cacheRead) startUsage.cache_read_input_tokens = cacheRead;
  if (cacheCreation) startUsage.cache_creation_input_tokens = cacheCreation;
  return [
    { type: "message_start", message: { id: "msg_e2e", model: "claude-opus-5-5", role: "assistant", content: [], usage: startUsage } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: output } },
    { type: "message_stop" },
  ];
}

function sseBody(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

// Run the events through the production SSE transform (claude upstream →
// openai client) and capture what onStreamComplete hands to persistence.
async function runClaudeStream(events) {
  let completedUsage;
  const transform = createSSETransformStreamWithLogger(
    FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "claude-opus-5-5", "conn-e2e", { messages: [] },
    (_content, usage) => { completedUsage = usage; }
  );
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody(events)));
      controller.close();
    },
  });
  const reader = source.pipeThrough(transform).getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += typeof value === "string" ? value : decoder.decode(value, { stream: true });
  }
  const chunks = out.split("\n")
    .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
    .map((l) => JSON.parse(l.slice(6)));
  return { chunks, completedUsage };
}

// saveUsageStats() is fire-and-forget; poll the DB for the row it writes.
async function waitForHistory(provider, model, count = 1) {
  for (let i = 0; i < 100; i++) {
    const rows = await db.getUsageHistory({ provider });
    const hit = rows.filter((r) => r.model === model);
    if (hit.length >= count) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`usageHistory row for ${provider}/${model} never appeared`);
}

// --- canonical persistence (pre-existing coverage) -------------------------

describe("cached-token end-to-end (persist + aggregate + cost)", () => {
  it("Claude cache usage: canonical prompt is inclusive, cached persisted, cost correct", async () => {
    // Raw Claude usage (cache-EXCLUSIVE prompt): input 100, cache_read 200, cache_creation 30, output 50
    const canonical = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    expect(canonical.prompt_tokens).toBe(330); // inclusive

    await db.saveRequestUsage({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      connectionId: "c-cache",
      tokens: canonical,
      endpoint: "/v1/messages",
      status: "ok",
    });

    const stats = await db.getUsageStats("24h");
    expect(stats.totalCachedTokens).toBe(200);
    expect(stats.totalPromptTokens).toBe(330);
    expect(stats.byProvider.anthropic.cachedTokens).toBe(200);

    // Cost: nonCached=330-200-30=100 @3 + cached 200 @0.30 + creation 30 @3.75 + output 50 @15
    const expected = (100 * 3 + 200 * 0.3 + 30 * 3.75 + 50 * 15) / 1_000_000;
    const hist = await db.getUsageHistory({ provider: "anthropic" });
    expect(hist.length).toBe(1);
    expect(hist[0].cost).toBeCloseTo(expected, 12);
    expect(hist[0].tokens.cached_tokens).toBe(200);
    expect(hist[0].tokens.cache_creation_input_tokens).toBe(30);
  });

  it("OpenAI cache usage: inclusive prompt passes through, cached counted once", async () => {
    const canonical = canonicalizeUsage({
      prompt_tokens: 1000,        // already includes cached
      completion_tokens: 200,
      cached_tokens: 600,
    });
    expect(canonical.prompt_tokens).toBe(1000);
    expect(canonical.cached_tokens).toBe(600);

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      connectionId: "c-oai",
      tokens: canonical,
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const hist = await db.getUsageHistory({ provider: "openai" });
    expect(hist[0].tokens.prompt_tokens).toBe(1000);
    expect(hist[0].tokens.cached_tokens).toBe(600);
  });
});

// --- Bug 1A: translator state.usage must not be folded twice ----------------

describe("claudeToOpenAIResponse state.usage → canonicalizeUsage (no double fold)", () => {
  // Numbers from production row id=1009040: input 2, cache_read 229469,
  // cache_creation 998 → real prompt 230469 (stored 460936 before the fix).
  const REAL = { input: 2, cacheRead: 229469, cacheCreation: 998, output: 1083 };
  const PROMPT = REAL.input + REAL.cacheRead + REAL.cacheCreation; // 230469

  function translatorStateUsage(ev) {
    const state = { toolCalls: new Map() };
    for (const e of ev) claudeToOpenAIResponse(e, state);
    return state.usage;
  }

  it("state.usage is already canonical and canonicalizeUsage is a no-op on it", () => {
    const usage = translatorStateUsage(claudeEvents(REAL));
    expect(usage.prompt_tokens).toBe(PROMPT);
    expect(usage.cached_tokens).toBe(REAL.cacheRead);
    expect(usage.cache_creation_input_tokens).toBe(REAL.cacheCreation);

    const canon = canonicalizeUsage(usage);
    expect(canon.prompt_tokens).toBe(PROMPT);
    expect(canon.prompt_tokens).not.toBe(PROMPT + REAL.cacheRead + REAL.cacheCreation);
    expect(canon.cached_tokens).toBe(REAL.cacheRead);
    expect(canon.cache_creation_input_tokens).toBe(REAL.cacheCreation);
    expect(canon.total_tokens).toBe(PROMPT + REAL.output);
  });

  it("cache-miss first write (creation only) is folded exactly once", () => {
    const usage = translatorStateUsage(claudeEvents({ input: 327, cacheCreation: 546, output: 19 }));
    const canon = canonicalizeUsage(usage);
    expect(canon.prompt_tokens).toBe(873);
    expect(canon.cached_tokens).toBe(0);
    expect(canon.cache_creation_input_tokens).toBe(546);
  });

  it("canonicalizeUsage refuses to re-fold a legacy pre-folded shape (no cached_tokens key)", () => {
    // Shape the translator emitted before the fix: folded prompt + raw input + cache_read, no cached_tokens.
    const legacy = {
      prompt_tokens: PROMPT, completion_tokens: REAL.output, total_tokens: PROMPT + REAL.output,
      input_tokens: REAL.input, output_tokens: REAL.output,
      cache_read_input_tokens: REAL.cacheRead, cache_creation_input_tokens: REAL.cacheCreation,
    };
    const canon = canonicalizeUsage(legacy);
    expect(canon.prompt_tokens).toBe(PROMPT);
    expect(canon.cached_tokens).toBe(REAL.cacheRead);
  });

  it("raw cache-exclusive Claude usage (extractUsage shape) is still folded", () => {
    const canon = canonicalizeUsage({ prompt_tokens: 2, completion_tokens: 5, cache_read_input_tokens: 229469, cache_creation_input_tokens: 998 });
    expect(canon.prompt_tokens).toBe(PROMPT);
  });
});

// --- full seam: createSSEStream → onStreamComplete → saveUsageStats → DB -----

describe("stream seam: claude upstream → openai client → persisted usage", () => {
  it("persists the real prompt (not 2x), cached tokens, and an un-inflated cost", async () => {
    const REAL = { input: 2, cacheRead: 229469, cacheCreation: 998, output: 1083 };
    const PROMPT = 230469;
    const model = "claude-opus-5-5";

    const { chunks, completedUsage } = await runClaudeStream(claudeEvents(REAL));
    expect(completedUsage).toBeTruthy();

    // Same call the production onStreamComplete makes (streamingHandler.buildOnStreamComplete).
    saveUsageStats({ provider: "claude", model, tokens: completedUsage, connectionId: "conn-e2e", endpoint: "/v1/chat/completions", silent: true });
    const [row] = await waitForHistory("claude", model);

    expect(row.tokens.prompt_tokens).toBe(PROMPT);
    expect(row.tokens.cached_tokens).toBe(REAL.cacheRead);
    expect(row.tokens.cache_creation_input_tokens).toBe(REAL.cacheCreation);
    expect(row.tokens.completion_tokens).toBe(REAL.output);
    // Reported cache ratio is back to ~99.57%, not ~49.78%.
    expect(row.tokens.cached_tokens / row.tokens.prompt_tokens).toBeGreaterThan(0.99);

    // claude-opus-5-5: input 4.00, cached 0.20, cache_creation 5.00, output 20.00 ($/1M)
    const expectedCost = (REAL.input * 4 + REAL.cacheRead * 0.2 + REAL.cacheCreation * 5 + REAL.output * 20) / 1_000_000;
    expect(row.cost).toBeCloseTo(expectedCost, 9);

    // usageDaily rollup reflects the same corrected numbers.
    const stats = await db.getUsageStats("all");
    expect(stats.byProvider.claude.promptTokens).toBe(PROMPT);
    expect(stats.byProvider.claude.cachedTokens).toBe(REAL.cacheRead);

    // --- Bug 1B: client-visible OpenAI usage keeps the cache details ---------
    const finish = chunks.find((c) => c.choices?.[0]?.finish_reason);
    expect(finish?.usage).toBeTruthy();
    expect(finish.usage.prompt_tokens_details?.cached_tokens).toBe(REAL.cacheRead);
    expect(finish.usage.prompt_tokens_details?.cache_creation_tokens).toBe(REAL.cacheCreation);
    // prompt_tokens is cache-inclusive (+ the 2000-token context buffer), never doubled.
    expect(finish.usage.prompt_tokens).toBe(PROMPT + 2000);
    expect(finish.usage.completion_tokens).toBe(REAL.output);
    // No Claude-only keys leak into an OpenAI-format client chunk.
    expect(finish.usage).not.toHaveProperty("cache_read_input_tokens");
    expect(finish.usage).not.toHaveProperty("input_tokens");
  });

  it("a no-cache Claude turn persists unchanged", async () => {
    const model = "claude-sonnet-5-5";
    const { completedUsage, chunks } = await runClaudeStream(claudeEvents({ input: 812, output: 20 }));
    saveUsageStats({ provider: "claude", model, tokens: completedUsage, connectionId: "conn-e2e", endpoint: "/v1/chat/completions", silent: true });
    const [row] = await waitForHistory("claude", model);
    expect(row.tokens.prompt_tokens).toBe(812);
    expect(row.tokens.cached_tokens).toBe(0);
    const finish = chunks.find((c) => c.choices?.[0]?.finish_reason);
    expect(finish.usage.prompt_tokens).toBe(812 + 2000);
    expect(finish.usage).not.toHaveProperty("prompt_tokens_details");
  });
});

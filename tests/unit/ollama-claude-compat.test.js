import { describe, expect, it } from "vitest";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";

// Phase 3 COMP-01/02/03. Proves existing same-format passthrough + generic usage
// extraction deliver the compatibility contract for ollama's Claude-native
// `/v1/messages` endpoint. Tolerate, don't strip (CONTEXT D-01); no normalizer
// (D-02); generic extraction (D-03).
//
// WR-01: Fallback routing (D-04) — resolveTransport(ollama, openai) === null —
// is NOT re-asserted here. Phase 1's transport test owns that contract
// (tests/unit/ollama-claude-transport.test.js Contract B + Contract C, which
// also proves the /api/chat fallback end-to-end via buildUrl). Re-asserting
// resolveTransport in isolation added zero signal.
//
// WR-02: COMP-02a/b/c assert same-format response identity passthrough — a
// provider-agnostic property of translateResponse (translator/index.js:152
// returns [chunk] when sourceFormat === targetFormat). The value is documenting
// that ollama's native Claude stop_reasons reach the client UNCHANGED because
// the gateway does not translate same-format responses — not because any
// ollama-specific code handles them.

describe("Phase 3: ollama claude compatibility contracts", () => {
  it("Contract COMP-01a: tool_choice preserved when tools array is non-empty (ollama)", () => {
    const model = "claude-sonnet-4-5";
    const toolChoice = { type: "auto" };
    const body = {
      model,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "get_weather", description: "weather", input_schema: { type: "object" } },
      ],
      tool_choice: toolChoice,
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    expect(result.tool_choice).toEqual(toolChoice);
  });

  it("Contract COMP-01b: metadata survives translateRequest(claude->claude, ollama)", () => {
    const model = "claude-sonnet-4-5";
    const metadata = { user_id: "u1" };
    const body = {
      model,
      messages: [{ role: "user", content: "hi" }],
      metadata,
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    expect(result.metadata).toEqual(metadata);
  });

  it("Contract COMP-01c: cache_control on last system block rewritten to ephemeral+ttl, not stripped (ollama)", () => {
    const model = "claude-sonnet-4-5";
    const body = {
      model,
      system: [
        { type: "text", text: "base instructions", cache_control: { type: "ephemeral" } },
        { type: "text", text: "tail instructions", cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: "hi" }],
    };

    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      model,
      body,
      false,
      null,
      "ollama"
    );

    // prepareClaudeRequest strips cache_control from all but last system block,
    // then rewrites the last as { type: "ephemeral", ttl: "1h" }. Proves tolerate-
    // don't-strip: cache_control survives in the canonical rewritten form.
    expect(Array.isArray(result.system)).toBe(true);
    expect(result.system.length).toBe(2);
    expect(result.system[0].cache_control).toBeUndefined();
    expect(result.system[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  // WR-03: covers the message-block cache_control path (claude.js:241-280) —
  // distinct from the system-array path. prepareClaudeRequest strips
  // cache_control from all content blocks, then re-adds { type: "ephemeral" }
  // (NO ttl) to the last non-thinking block of the first assistant message.
  it("Contract COMP-01d: cache_control on message content blocks rewritten (ollama)", () => {
    const body = {
      model: "claude-sonnet-4-5",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "p1", cache_control: { type: "ephemeral" } },
            { type: "text", text: "p2", cache_control: { type: "ephemeral" } },
          ],
        },
        { role: "user", content: "again" },
      ],
    };
    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      "claude-sonnet-4-5",
      body,
      false,
      null,
      "ollama"
    );
    const assistant = result.messages.find(m => m.role === "assistant");
    // First (non-last) block: cache_control stripped, not re-added.
    expect(assistant.content[0].cache_control).toBeUndefined();
    // Last non-thinking block of the last assistant: re-added as ephemeral, NO ttl.
    expect(assistant.content[1].cache_control).toEqual({ type: "ephemeral" });
  });

  // WR-02: same-format response identity passthrough (provider-agnostic).
  // Documents that ollama's native Claude stop_reasons reach the client
  // unchanged because translateResponse returns [chunk] when
  // sourceFormat === targetFormat — not via any ollama-specific handling.
  it("Contract COMP-02a: same-format passthrough delivers stop_reason='tool_use' unchanged (provider-agnostic identity)", () => {
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 1 },
    };
    const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(chunk);
    expect(result[0].delta.stop_reason).toBe("tool_use");
  });

  it("Contract COMP-02b: same-format passthrough delivers stop_reason='end_turn' unchanged (provider-agnostic identity)", () => {
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 1 },
    };
    const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(result.length).toBe(1);
    expect(result[0]).toBe(chunk);
    expect(result[0].delta.stop_reason).toBe("end_turn");
  });

  it("Contract COMP-02c: same-format passthrough delivers stop_reason='max_tokens' unchanged (provider-agnostic identity)", () => {
    const chunk = {
      type: "message_delta",
      delta: { stop_reason: "max_tokens" },
      usage: { output_tokens: 1 },
    };
    const result = translateResponse(FORMATS.CLAUDE, FORMATS.CLAUDE, chunk, {});
    expect(result.length).toBe(1);
    expect(result[0]).toBe(chunk);
    expect(result[0].delta.stop_reason).toBe("max_tokens");
  });

  it("Contract COMP-03a: extractUsage reads input_tokens from message_start (Claude shape)", () => {
    const start = {
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    };
    const u = extractUsage(start);
    expect(u).not.toBeNull();
    expect(u.prompt_tokens).toBe(100);
  });

  it("Contract COMP-03b: extractUsage reads output_tokens from message_delta (Claude shape)", () => {
    const delta = { type: "message_delta", usage: { output_tokens: 50 } };
    const u = extractUsage(delta);
    expect(u).not.toBeNull();
    expect(u.completion_tokens).toBe(50);
  });

  it("Contract COMP-03c: mergeUsage(start, delta) preserves input from start and output from delta", () => {
    const start = {
      type: "message_start",
      message: { usage: { input_tokens: 100 } },
    };
    const delta = { type: "message_delta", usage: { output_tokens: 50 } };
    const merged = mergeUsage(extractUsage(start), extractUsage(delta));
    expect(merged.prompt_tokens).toBe(100);
    expect(merged.completion_tokens).toBe(50);
  });

  it("Contract COMP-03d: cache_read_input_tokens flows through extractUsage + mergeUsage", () => {
    // Proves ollama cache fields ride the same Claude-shape branch (provider-agnostic).
    const start = {
      type: "message_start",
      message: { usage: { input_tokens: 100, cache_read_input_tokens: 40 } },
    };
    const delta = { type: "message_delta", usage: { output_tokens: 50 } };
    const merged = mergeUsage(extractUsage(start), extractUsage(delta));
    expect(merged.cache_read_input_tokens).toBe(40);
  });

  // WR-05: symmetric to COMP-03d. canonicalizeUsage (usageTracking.js:171)
  // notes a first-write cache-miss carries ONLY cache_creation (no cache_read)
  // — the field more likely to appear alone in real traffic. Guards against
  // silent token-drop regressions on the unmapped half of the pair.
  it("Contract COMP-03d-cache-creation: cache_creation_input_tokens flows through extractUsage + mergeUsage", () => {
    const start = {
      type: "message_start",
      message: { usage: { input_tokens: 100, cache_creation_input_tokens: 15 } },
    };
    const delta = { type: "message_delta", usage: { output_tokens: 50 } };
    const merged = mergeUsage(extractUsage(start), extractUsage(delta));
    expect(merged.cache_creation_input_tokens).toBe(15);
  });

  // WR-04: extractUsage has a dedicated ollama NDJSON branch
  // (usageTracking.js:297-305) keyed on done === true && prompt_eval_count.
  // This is the native /api/chat fallback shape (non-Claude path). Complementary
  // to the Claude-shape usage tests above — guards the non-Claude fallback's
  // usage tracking too.
  it("Contract COMP-03e: extractUsage reads ollama NDJSON (done + prompt_eval_count)", () => {
    const chunk = {
      model: "llama3",
      done: true,
      prompt_eval_count: 30,
      eval_count: 20,
    };
    const u = extractUsage(chunk);
    expect(u).not.toBeNull();
    expect(u.prompt_tokens).toBe(30);
    expect(u.completion_tokens).toBe(20);
    expect(u.total_tokens).toBe(50);
  });
});

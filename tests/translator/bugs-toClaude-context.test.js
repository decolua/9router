// OpenAI-format CLI → Claude provider. Context pollution + lossy mapping on the openai→claude leg.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

// anthropic-compatible provider so prepareClaudeRequest runs the openai→claude path
const T = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "m", body, true, null, "anthropic-compatible-x");

describe("OpenAI → Claude context mapping", () => {
  // openai-to-claude.js:124-134 — always injects CLAUDE_SYSTEM_PROMPT ("You are Claude Code")
  // KNOWN BUG: pollutes requests for non-official Claude-compatible providers
  it.fails("does not inject Claude Code system prompt for compatible providers", () => {
    const out = T({ messages: [{ role: "user", content: "hi" }] });
    expect(JSON.stringify(out.system), "Claude Code prompt injected").not.toContain("Claude Code");
  });

  it("assistant reasoning_content becomes a thinking block", () => {
    const out = T({
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a", reasoning_content: "my hidden reasoning" },
        { role: "user", content: "next" },
      ],
    });
    expect(JSON.stringify(out), "reasoning_content lost").toContain("my hidden reasoning");
    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual(expect.objectContaining({
      type: "thinking",
      thinking: "my hidden reasoning",
    }));
  });

  // openai-to-claude.js:298 — tool_choice "none" mapped to {type:"auto"} (loses "do not call" intent)
  // KNOWN BUG
  it.fails("tool_choice=none is not turned into auto", () => {
    const out = T({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object", properties: {} } } }],
      tool_choice: "none",
    });
    expect(out.tool_choice?.type, "none became auto → model may call tools").not.toBe("auto");
  });

  // getContentBlocksFromMessage — no input_audio branch → audio dropped
  // KNOWN BUG
  it.fails("input_audio content is preserved", () => {
    const out = T({
      messages: [{ role: "user", content: [
        { type: "text", text: "transcribe" },
        { type: "input_audio", input_audio: { data: "AUDIO_B64", format: "wav" } },
      ] }],
    });
    expect(JSON.stringify(out), "audio dropped").toContain("AUDIO_B64");
  });

  // openai-to-claude.js:235-251 — remote http image_url is kept (regression guard)
  it("remote http image_url is preserved", () => {
    const out = T({
      messages: [{ role: "user", content: [
        { type: "text", text: "see" },
        { type: "image_url", image_url: { url: "https://x.com/pic.png" } },
      ] }],
    });
    expect(JSON.stringify(out), "remote image dropped").toContain("pic.png");
  });

  // prepareClaudeRequest reconciles max_tokens vs thinking.budget_tokens.
  // applyThinking runs after adjustMaxTokens caps max_tokens, so a claude-budget
  // model at "max" effort (budget 128000) can exceed the clamped max_tokens and
  // trip Anthropic's "max_tokens > budget_tokens" rule (400). See claude.js.
  describe("max_tokens vs thinking.budget_tokens reconciliation", () => {
    // 64k-ceiling model (maxOutput 64000) + max-effort budget 128000: budget alone
    // exceeds the ceiling → cap max_tokens at 64000 and shrink budget below it.
    it("max effort budget on a 64k model → budget < max_tokens ≤ 64000", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 64000,
        thinking: { type: "enabled", budget_tokens: 128000 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
      expect(out.thinking.budget_tokens).toBeLessThan(out.max_tokens);
      expect(out.thinking.budget_tokens).toBeGreaterThan(0);
    });

    // Budget fits under the ceiling but exceeds a small client max_tokens →
    // raise max_tokens to fit, preserving the requested thinking depth.
    it("xhigh budget with a low client max_tokens → raise max_tokens, preserve budget", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 16000,
        thinking: { type: "enabled", budget_tokens: 32768 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.thinking.budget_tokens).toBe(32768);
      expect(out.max_tokens).toBe(33792); // 32768 + 1024, under the 64000 ceiling
    });

    // Budget already below max_tokens → nothing to reconcile.
    it("high budget under max_tokens → both unchanged", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 64000,
        thinking: { type: "enabled", budget_tokens: 24576 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
      expect(out.thinking.budget_tokens).toBe(24576);
    });

    // Non-budget thinking shapes (adaptive / disabled) carry no budget_tokens →
    // the reconciliation must never touch them.
    it("adaptive thinking (no budget_tokens) is left untouched", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
      expect(out.thinking).toEqual({ type: "adaptive" });
    });

    // Lifted ceiling: a claude-budget model whose caps declare maxOutput 128000
    // (e.g. fable) may use the full budget at max effort instead of being pinned
    // to the conservative 64000 default.
    it("max effort budget on a 128k model → max_tokens up to 128000, budget preserved just under", () => {
      const out = prepareClaudeRequest({
        model: "claude-fable-5",
        max_tokens: 64000,
        thinking: { type: "enabled", budget_tokens: 128000 },
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(128000);
      expect(out.thinking.budget_tokens).toBe(126976); // 128000 - 1024
      expect(out.thinking.budget_tokens).toBeLessThan(out.max_tokens);
    });

    // Regression: a default 64k-ceiling model still clamps an over-large client
    // max_tokens down to 64000 (the lift is per-model, not global).
    it("over-large client max_tokens on a 64k model is still clamped to 64000", () => {
      const out = prepareClaudeRequest({
        model: "claude-opus-4-20250514",
        max_tokens: 120000,
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(64000);
    });

    // Lifted ceiling for a 128k model: a large client max_tokens is now allowed
    // through instead of being clamped to 64000.
    it("large client max_tokens on a 128k model is allowed up to maxOutput", () => {
      const out = prepareClaudeRequest({
        model: "claude-fable-5",
        max_tokens: 100000,
        messages: [{ role: "user", content: "q" }],
      }, "anthropic");
      expect(out.max_tokens).toBe(100000);
    });
  });

  it("DeepSeek Claude transport adds a thinking placeholder before tool_use in thinking mode", () => {
    const out = prepareClaudeRequest({
      model: "deepseek-v4-pro",
      thinking: { type: "enabled" },
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
        { role: "user", content: [{ type: "text", text: "continue" }] },
      ],
    }, "deepseek");

    const assistant = out.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "." });
    expect(assistant.content[1]).toEqual(expect.objectContaining({ type: "tool_use", id: "toolu_1" }));
    expect(assistant.content[0].signature).toBeUndefined();
  });
});

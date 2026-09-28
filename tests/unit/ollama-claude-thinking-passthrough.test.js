import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Phase 2: Thinking passthrough for ollama claude transport", () => {
  it("Contract THINK-02: applyThinking no-ops on ollama+claude path", () => {
    const body = { thinking: { type: "enabled" }, output_config: { effort: "high" } };
    const out = applyThinking(FORMATS.CLAUDE, "ollama-model", body, "ollama");
    expect(out.thinking.type).toBe("enabled");
    expect(out.output_config.effort).toBe("high");
  });

  it("Contract THINK-02 negative: applyThinking still strips for non-ollama non-reasoning provider", () => {
    const body = { thinking: { type: "enabled" }, output_config: { effort: "high" } };
    const out = applyThinking(FORMATS.CLAUDE, "some-model", body, "nonexistent-provider");
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });

  it("Contract THINK-03: providerThinking-injected thinking survives to translateRequest output", () => {
    const body = {
      model: "ollama-model",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 10000 },
    };
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      "ollama-model",
      body,
      false,
      null,
      "ollama",
    );
    expect(out.thinking.type).toBe("enabled");
  });

  it("Contract THINK-01 request: thinking content blocks in assistant messages survive translateRequest", () => {
    const body = {
      model: "ollama-model",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "reasoning here", signature: "sig-abc" },
            { type: "text", text: "answer" },
          ],
        },
        { role: "user", content: "continue" },
      ],
    };
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      "ollama-model",
      body,
      false,
      null,
      "ollama",
    );
    const assistantMsg = out.messages.find((m) => m.role === "assistant");
    const thinkingBlock = assistantMsg.content.find((b) => b.type === "thinking");
    expect(thinkingBlock).toBeDefined();
    expect(thinkingBlock.thinking).toBe("reasoning here");
    expect(thinkingBlock.signature).toBe("sig-abc");
  });

  // WR-02: exercise chatCore.js:59-69 providerThinking injection path.
  // Mirror chatCore injection: set body.reasoning_effort = "high" (level mode)
  // OR body.thinking = { type: "enabled" } (on mode) BEFORE applyThinking,
  // then assert the body is valid for ollama's Claude endpoint.
  // Covers WR-01: reasoning_effort must be normalized away / output_config.effort set.
  it("Contract THINK-03b: providerThinking level-mode (high) injection normalized to Claude shape", () => {
    // Simulate chatCore injection for providerThinking.ollama = { mode: "high" }:
    // chatCore.js:66-68 sets body.reasoning_effort = mode (else-if branch, not on/off).
    const body = {
      model: "ollama-model",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    };
    const out = applyThinking(FORMATS.CLAUDE, "ollama-model", body, "ollama");
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.output_config).toBeDefined();
    expect(out.output_config.effort).toBe("high");
  });

  it("Contract THINK-03c: providerThinking on-mode injection (thinking) preserved, reasoning_effort dropped", () => {
    // Simulate chatCore injection for providerThinking.ollama = { mode: "on" }:
    // chatCore.js:61-63 sets body.thinking = { type: "enabled", budget_tokens: 10000 }.
    // Also inject a stray reasoning_effort to confirm Claude-native thinking wins.
    const body = {
      model: "ollama-model",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 10000 },
      reasoning_effort: "high",
    };
    const out = applyThinking(FORMATS.CLAUDE, "ollama-model", body, "ollama");
    expect(out.thinking).toBeDefined();
    expect(out.thinking.type).toBe("enabled");
    expect(out.thinking.budget_tokens).toBe(10000);
    expect(out.reasoning_effort).toBeUndefined();
  });

  // WR-03: verify short-circuit still fires for reasoning-capable ollama models.
  // CONTEXT decision: applyThinking is a no-op on the claude→ollama path, NOT
  // capability-gated. Even if the model is reasoning-capable (kimi-k2.5 matches
  // *kimi*k2* → reasoning:true, thinkingFormat:"openai"), the short-circuit must
  // fire so the client's Claude-format thinking/effort survive verbatim (not
  // rewritten to reasoning_effort by resolveFormat("openai")).
  it("Contract THINK-02 reasoning: short-circuit preserves Claude thinking fields for reasoning-capable ollama model", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 10000 }, output_config: { effort: "high" } };
    // kimi-k2.5 is in ollama registry and matches *kimi*k2* → reasoning:true, thinkingFormat:"openai".
    const out = applyThinking(FORMATS.CLAUDE, "kimi-k2.5", body, "ollama");
    expect(out.thinking.type).toBe("enabled");
    expect(out.thinking.budget_tokens).toBe(10000);
    expect(out.output_config.effort).toBe("high");
    // Critical: resolveFormat("openai") would have set reasoning_effort and stripped
    // thinking/output_config. Verify that DID NOT happen.
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("Contract THINK-02 reasoning: reasoning-capable ollama model normalizes injected reasoning_effort", () => {
    // Same model (kimi-k2.5, reasoning:true) with chatCore-injected reasoning_effort.
    // Short-circuit must still normalize the OpenAI field to Claude shape.
    const body = { model: "kimi-k2.5", messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" };
    const out = applyThinking(FORMATS.CLAUDE, "kimi-k2.5", body, "ollama");
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.output_config).toBeDefined();
    expect(out.output_config.effort).toBe("high");
  });

  // WR-05: document accepted behavior. CONTEXT decision says applyThinking is a
  // no-op on the claude→ollama path (preserve client body verbatim). A client-set
  // model suffix like "kimi-k2.5(high)" is an OpenAI-format niche feature; on the
  // Claude transport the client should send Claude-format fields directly. The
  // short-circuit fires before parseSuffix, so the suffix override is dropped —
  // this is the documented ceiling. chatCore.js:138 strips the suffix from the
  // upstream model id, so the upstream receives a valid model id regardless.
  it("Contract THINK-04 ceiling: model-suffix thinking override is dropped on ollama+claude path (WR-05 accepted behavior)", () => {
    // Client sends model: "kimi-k2.5(high)" expecting suffix override to set
    // thinking level. On ollama+claude the short-circuit fires before parseSuffix,
    // so the override is NOT applied. Document the ceiling: use Claude-format
    // fields (output_config.effort) directly when on the Claude transport.
    const body = { model: "kimi-k2.5(high)", messages: [{ role: "user", content: "hi" }], output_config: { effort: "low" } };
    const out = applyThinking(FORMATS.CLAUDE, "kimi-k2.5(high)", body, "ollama");
    // Client-set Claude field survives verbatim (short-circuit is a no-op on body).
    expect(out.output_config.effort).toBe("low");
    // The suffix override "high" is NOT applied — the client's explicit low wins.
    // chatCore.js:138 (stripThinkingSuffix) cleans the model id separately, so
    // upstream receives "kimi-k2.5" (verified by stripThinkingSuffix, not here).
  });
});
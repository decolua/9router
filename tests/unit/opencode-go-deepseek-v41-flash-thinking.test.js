// OpenCode Go serves deepseek-v4.1-flash on /zen/go/v1/messages, which is anthropic-shaped
// but is not a native Anthropic target: it rejects the Chat-shaped reasoning_effort that the
// model's deepseek capability entry emits with
//   400 reasoning_effort: requires a native Anthropic Messages target
// and accepts the adaptive pair (thinking.type + output_config.effort) instead. Claude Code
// 2.1.318 sends an effort intent on every turn, so the whole route hard-400s (#5480).
//
// The fix lives on the transport, not in PROVIDER_CAPABILITIES: the same model id keeps the
// deepseek shape on /chat/completions, which needs exactly those Chat fields (#3014). These
// tests drive the real applyThinking() so a regression shows up as the rejected shape.
import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// What Claude Code 2.1.318 puts on the wire for a medium-effort turn.
const claudeCodeBody = () => ({
  model: "deepseek-v4.1-flash",
  max_tokens: 4096,
  thinking: { type: "adaptive", display: "omitted" },
  output_config: { effort: "medium" },
  messages: [{ role: "user", content: "hi" }],
});

describe("opencode-go deepseek-v4.1-flash thinking shape per endpoint", () => {
  it("the model's capability entry still carries the deepseek shape", () => {
    // The override must not be hoisted into the provider capability table: it would also
    // rewrite the /chat/completions body.
    expect(getCapabilitiesForModel("opencode-go", "deepseek-v4.1-flash").thinkingFormat).toBe("deepseek");
  });

  it("/messages gets thinking.type=adaptive + output_config.effort, never reasoning_effort", () => {
    const body = applyThinking("claude", "deepseek-v4.1-flash", claudeCodeBody(), "opencode-go");

    expect(body.thinking?.type).toBe("adaptive");
    expect(body.thinking?.display).toBe("omitted");
    expect(body.thinking).not.toHaveProperty("budget_tokens");
    expect(body.output_config?.effort).toBe("medium");
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("/messages still expresses a thinking-off turn (the lane accepts type=disabled)", () => {
    const body = applyThinking("claude", "deepseek-v4.1-flash(none)", claudeCodeBody(), "opencode-go");

    expect(body.thinking?.type).toBe("disabled");
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("/chat/completions keeps the deepseek shape the endpoint needs", () => {
    const body = applyThinking(
      "openai",
      "deepseek-v4.1-flash",
      { model: "deepseek-v4.1-flash", max_tokens: 4096, reasoning_effort: "high", messages: [{ role: "user", content: "hi" }] },
      "opencode-go",
    );

    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.output_config).toBeUndefined();
  });

  it("/messages matches the id through a vendor prefix", () => {
    const body = applyThinking("claude", "ocg/deepseek-v4.1-flash", claudeCodeBody(), "opencode-go");

    expect(body.thinking?.type).toBe("adaptive");
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("the same model behind a provider that did not declare the shape is untouched", () => {
    const body = applyThinking("claude", "deepseek-v4.1-flash", claudeCodeBody(), "deepseek");

    expect(body.reasoning_effort).toBeTruthy();
    expect(body.output_config).toBeUndefined();
  });
});

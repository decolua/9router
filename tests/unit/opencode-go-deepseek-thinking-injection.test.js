/**
 * opencode-go DeepSeek models on the claude→claude /messages passthrough need
 * the same thinking-block handling as the official deepseek provider (#3332):
 * keep existing thinking blocks verbatim, and inject an UNSIGNED placeholder
 * on tool_use turns that carry none while thinking is enabled — upstream 400s
 * with "The content[].thinking in the thinking mode must be passed back to the
 * API" otherwise. The gate is model-based because opencode-go also serves
 * non-DeepSeek models over /messages (minimax, qwen) that must stay untouched.
 *
 * Signed placeholders were also accepted live (2026-08-15, opencode.go /messages),
 * but unsigned mirrors the official deepseek provider behavior exactly.
 */
import { describe, it, expect } from "vitest";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

function makeBody(model) {
  return {
    model,
    max_tokens: 2048,
    thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_weather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "18C" },
        ],
      },
    ],
  };
}

function firstBlock(body) {
  return body.messages[0].content[0];
}

describe("prepareClaudeRequest — opencode-go DeepSeek thinking pass-back", () => {
  it("injects an unsigned thinking placeholder on tool_use turns missing one", () => {
    const out = prepareClaudeRequest(
      makeBody("opencode-go/deepseek-v4-pro(max)"),
      "opencode-go",
    );

    const block = firstBlock(out);
    expect(block.type).toBe("thinking");
    expect(block.signature).toBeUndefined();
    expect(out.messages[0].content).toHaveLength(2); // placeholder + tool_use
  });

  it("keeps an existing thinking block verbatim (no re-sign, no duplicate)", () => {
    const body = makeBody("opencode-go/deepseek-v4-flash");
    const realThinking = {
      type: "thinking",
      thinking: "actual reasoning",
      signature: "sig_from_upstream",
    };
    body.messages[0].content.unshift(realThinking);

    const out = prepareClaudeRequest(body, "opencode-go");

    const thinking = out.messages[0].content.filter(
      (b) => b.type === "thinking",
    );
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toEqual(realThinking);
  });

  it("leaves non-DeepSeek opencode-go models untouched (minimax rides /messages too)", () => {
    const out = prepareClaudeRequest(
      makeBody("opencode-go/minimax-m3"),
      "opencode-go",
    );

    expect(out.messages[0].content).toHaveLength(1); // tool_use only
    expect(firstBlock(out).type).toBe("tool_use");
  });

  it("official deepseek provider keeps injecting unsigned placeholders (regression)", () => {
    const out = prepareClaudeRequest(makeBody("deepseek-v4-pro"), "deepseek");

    const block = firstBlock(out);
    expect(block.type).toBe("thinking");
    expect(block.signature).toBeUndefined();
  });

  it.todo(
    "inject a reasoning placeholder into Responses `input` items for DeepSeek models — " +
      "injectReasoningContent only rewrites body.messages, so responses-format clients " +
      "replaying reasoning-bearing sessions on the openai-responses transport are " +
      "uncovered (#3332 restore gate: Codex-shaped payload must stay 200)",
  );
});

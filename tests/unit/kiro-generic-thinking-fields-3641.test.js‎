// #3641 — Kiro models answer 400 REQUEST_BODY_INVALID when the client's wire
// format is neither OpenAI Chat nor Claude. translator/index.js exempts Kiro
// from the generic applyThinking pass by SOURCE format, so a Responses (Codex)
// or Gemini client falls through it and the generic normalizer stamps a
// top-level `thinking` onto the finished conversationState payload —
// a member generateAssistantResponse has no place for. The Kiro request
// translators already map thinking intent themselves (system prefix +
// additionalModelRequestFields), so the second pass is pure contamination.
import { describe, it, expect } from "vitest";
import { translateRequest } from "open-sse/translator/index.js";
import { KiroExecutor } from "open-sse/executors/kiro.js";

const CREDS = { providerSpecificData: {} };

function kiroBodyFrom(sourceFormat, body, model = "claude-sonnet-4.5") {
  return translateRequest(sourceFormat, "kiro", model, body, false, CREDS, "kiro");
}

describe("Kiro rejects generic thinking fields (#3641)", () => {
  it("strips a top-level thinking object left by a Responses client", () => {
    const payload = kiroBodyFrom("openai-responses", {
      model: "claude-sonnet-4.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      reasoning: { effort: "medium" },
    });
    // Precondition: the generic pass really did contaminate the payload.
    expect(payload.thinking).toBeDefined();

    const sent = new KiroExecutor().transformRequest("claude-sonnet-4.5", payload, false, CREDS);
    expect(sent.thinking).toBeUndefined();
    expect(sent.reasoning).toBeUndefined();
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.output_config).toBeUndefined();
    // Everything the schema does define survives.
    expect(sent.conversationState).toBeDefined();
    expect(sent.agentMode).toBe("vibe");
    expect(sent.inferenceConfig).toBeDefined();
  });

  it("strips the same fields for a Gemini client", () => {
    const payload = kiroBodyFrom("gemini", {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 4096 } },
    });
    expect(payload.thinking).toBeDefined();

    const sent = new KiroExecutor().transformRequest("claude-sonnet-4.5", payload, false, CREDS);
    expect(sent.thinking).toBeUndefined();
    expect(sent.thinkingConfig).toBeUndefined();
    expect(sent.enable_thinking).toBeUndefined();
  });

  it("keeps the effort fields Kiro does accept, nested under additionalModelRequestFields", () => {
    const payload = kiroBodyFrom("openai", {
      model: "claude-opus-4.8",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "high",
    }, "claude-opus-4.8");
    const sent = new KiroExecutor().transformRequest("claude-opus-4.8", payload, false, CREDS);
    expect(sent.additionalModelRequestFields).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
    });
    expect(sent.thinking).toBeUndefined();
    expect(sent.output_config).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { applyThinking, captureThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const customProvider = "openai-compatible-chat-budget-test";
const model = "deepseek-v4-flash";

describe("DeepSeek thinking budgets (#5108)", () => {
  it.each([2048, 98304])("preserves explicit budget_tokens=%s on a custom DeepSeek host", (budget) => {
    const body = { thinking: { type: "enabled", budget_tokens: budget }, max_tokens: 131072 };
    applyThinking(FORMATS.OPENAI, model, body, customProvider);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: budget });
    expect(body.max_tokens).toBe(131072);
  });

  it("preserves a captured budget after the source thinking field is removed", () => {
    const intent = captureThinking({ thinking: { type: "enabled", budget_tokens: 2048 } });
    const body = { max_tokens: 4096 };
    applyThinking(FORMATS.OPENAI, model, body, customProvider, intent);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("carries a Claude client's budget through the request translator", () => {
    const body = {
      messages: [{ role: "user", content: "Reply OK" }],
      max_tokens: 4096,
      thinking: { type: "enabled", budget_tokens: 2048 },
    };
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, model, body, false, null, customProvider);
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(out.messages).toEqual([{ role: "user", content: "Reply OK" }]);
  });

  it("does not invent a budget for an effort-only request", () => {
    const body = { reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI, model, body, customProvider);
    expect(body).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  });

  it("keeps disabled thinking disabled without a budget", () => {
    const body = { thinking: { type: "disabled", budget_tokens: 2048 } };
    applyThinking(FORMATS.OPENAI, model, body, customProvider);
    expect(body).toEqual({ thinking: { type: "disabled" } });
  });

  it("leaves registered DeepSeek providers on the legacy enabled marker", () => {
    for (const provider of ["deepseek", "together", "opencode-go", "xiaomi-mimo"]) {
      const body = { thinking: { type: "enabled", budget_tokens: 2048 } };
      applyThinking(FORMATS.OPENAI, model, body, provider);
      expect(body.thinking).toEqual({ type: "enabled" });
    }
  });

  it("keeps a Responses transport's nested effort shape", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 2048 } };
    applyThinking(FORMATS.OPENAI_RESPONSES, "deepseek-v4.1-flash", body, "opencode-go");
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "low", summary: "auto" });
  });
});

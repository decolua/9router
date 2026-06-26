// Regression tests for paramSupport rules without a `match` predicate or `drop`
// list (e.g. the provider-wide `cloudflare-ai` flattenContent rule). Previously
// `matches()` ran `rule.match.test(model)` on an undefined `rule.match` and the
// drop loop iterated an undefined `rule.drop`, crashing every Cloudflare request
// with "Cannot read properties of undefined (reading 'test')". Fixes #2097.
import { describe, it, expect } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams: rule without match/drop (cloudflare-ai)", () => {
  it("does not throw for a cloudflare-ai model and flattens content", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "Reply exactly OK" }] },
      ],
    };

    expect(() =>
      stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.2-1b-instruct", body)
    ).not.toThrow();

    // flattenContent: OpenAI content-part array collapses to a plain string (#1926)
    expect(body.messages[0].content).toBe("Reply exactly OK");
  });

  it("leaves a non-matching provider untouched", () => {
    const body = { messages: [{ role: "user", content: "hi" }], temperature: 0.7 };
    const out = stripUnsupportedParams("openai", "gpt-4o", body);
    expect(out.temperature).toBe(0.7);
    expect(out.messages[0].content).toBe("hi");
  });

  it("still drops params for rules that define a drop list", () => {
    const body = { messages: [{ role: "user", content: "hi" }], temperature: 0.5 };
    // claude-opus-4 series: temperature is deprecated (Anthropic 400). #1748
    stripUnsupportedParams("anthropic", "claude-opus-4-20250101", body);
    expect(body.temperature).toBeUndefined();
  });
});

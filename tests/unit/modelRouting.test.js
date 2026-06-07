import { describe, it, expect } from "vitest";
import { routeModel, formatRoutingLog } from "../../open-sse/rtk/modelRouting.js";

const RULES = {
  "anthropic/claude-sonnet-4-5": {
    cheap: "anthropic/claude-haiku-4-5",
    strong: "anthropic/claude-opus-4-1",
  },
  "openai/gpt-5": {
    cheap: "openai/gpt-5-mini",
  },
};

describe("routeModel", () => {
  it("returns null when disabled", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    expect(routeModel(body, "anthropic/claude-sonnet-4-5", false, RULES)).toBeNull();
  });

  it("returns null when no rule for model", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    expect(routeModel(body, "no/such-model", true, RULES)).toBeNull();
  });

  it("downgrades simple short request to cheap variant", () => {
    const body = { messages: [{ role: "user", content: "summarize this please" }] };
    const dec = routeModel(body, "anthropic/claude-sonnet-4-5", true, RULES);
    expect(dec).not.toBeNull();
    expect(dec.to).toBe("anthropic/claude-haiku-4-5");
    expect(dec.classification).toBe("simple");
  });

  it("upgrades complex requests when strong is configured", () => {
    const longText = "x".repeat(8000);
    const body = { messages: [{ role: "user", content: longText }] };
    const dec = routeModel(body, "anthropic/claude-sonnet-4-5", true, RULES);
    expect(dec?.to).toBe("anthropic/claude-opus-4-1");
    expect(dec?.classification).toBe("complex");
  });

  it("returns null when complex but no strong rule configured", () => {
    const longText = "x".repeat(8000);
    const body = { messages: [{ role: "user", content: longText }] };
    expect(routeModel(body, "openai/gpt-5", true, RULES)).toBeNull();
  });

  it("treats tools-present as complex", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "f" } }],
    };
    const dec = routeModel(body, "anthropic/claude-sonnet-4-5", true, RULES);
    expect(dec?.classification).toBe("complex");
  });

  it("treats fenced code as complex", () => {
    const body = { messages: [{ role: "user", content: "fix this:\n```js\nconst x=1\n```" }] };
    const dec = routeModel(body, "anthropic/claude-sonnet-4-5", true, RULES);
    expect(dec?.classification).toBe("complex");
  });

  it("treats images as complex", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } },
          ],
        },
      ],
    };
    const dec = routeModel(body, "anthropic/claude-sonnet-4-5", true, RULES);
    expect(dec?.classification).toBe("complex");
  });

  it("treats high reasoning effort as complex", () => {
    const body = {
      messages: [{ role: "user", content: "small" }],
      reasoning_effort: "high",
    };
    const dec = routeModel(body, "anthropic/claude-sonnet-4-5", true, RULES);
    expect(dec?.classification).toBe("complex");
  });

  it("no-op when target equals original", () => {
    const rules = { "x/y": { cheap: "x/y" } };
    const body = { messages: [{ role: "user", content: "hi" }] };
    expect(routeModel(body, "x/y", true, rules)).toBeNull();
  });

  it("formatRoutingLog produces readable line", () => {
    const line = formatRoutingLog({ from: "a/b", to: "c/d", reason: "simple→cheap" });
    expect(line).toContain("a/b → c/d");
    expect(line).toContain("simple→cheap");
  });
});

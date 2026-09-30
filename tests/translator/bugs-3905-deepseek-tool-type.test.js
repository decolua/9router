// Regression for #3905: defaultClaudeToolType() (type:"custom") must only run for
// gateways that declare the requireClaudeToolType quirk (MiniMax). Claude-format
// endpoints that only accept the legacy typeless tool shape — e.g. DeepSeek's
// Anthropic-compatible endpoint, which answers HTTP 400 "unknown variant `custom`" —
// must never receive tools[].type = "custom".
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { shouldDefaultClaudeToolType } from "../../open-sse/translator/concerns/toolCall.js";

const tools = [{ name: "get_weather", description: "weather", input_schema: { type: "object" } }];

describe("Claude tool `type` defaulting is provider-scoped (#3905)", () => {
  it("runs only for providers declaring requireClaudeToolType", () => {
    expect(shouldDefaultClaudeToolType("minimax", FORMATS.CLAUDE, tools, PROVIDERS)).toBe(true);
    expect(shouldDefaultClaudeToolType("minimax-cn", FORMATS.CLAUDE, tools, PROVIDERS)).toBe(true);
    // Endpoints accepting only the legacy typeless shape must NOT get type:"custom".
    expect(shouldDefaultClaudeToolType("deepseek", FORMATS.CLAUDE, tools, PROVIDERS)).toBe(false);
    expect(shouldDefaultClaudeToolType("claude", FORMATS.CLAUDE, tools, PROVIDERS)).toBe(false);
  });

  it("never applies outside Claude-format requests or without tools", () => {
    expect(shouldDefaultClaudeToolType("minimax", FORMATS.OPENAI, tools, PROVIDERS)).toBe(false);
    expect(shouldDefaultClaudeToolType("minimax", FORMATS.CLAUDE, undefined, PROVIDERS)).toBe(false);
    expect(shouldDefaultClaudeToolType("minimax", FORMATS.CLAUDE, null, PROVIDERS)).toBe(false);
  });

  it("declares the quirk only on the MiniMax providers (registry tripwire)", () => {
    expect(PROVIDERS.minimax?.quirks?.requireClaudeToolType).toBe(true);
    expect(PROVIDERS["minimax-cn"]?.quirks?.requireClaudeToolType).toBe(true);
    expect(PROVIDERS.deepseek?.quirks?.requireClaudeToolType).toBeUndefined();
  });
});

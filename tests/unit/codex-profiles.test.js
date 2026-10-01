import { describe, expect, it } from "vitest";
import {
  deriveProfileNameFromModel,
  buildCodexProfileToml,
  parseCodexProfileModel,
} from "../../src/app/(dashboard)/dashboard/cli-tools/components/codexConfig.js";

describe("Codex profiles configuration", () => {
  it("derives provider name as profile name and avoids conflicts", () => {
    expect(deriveProfileNameFromModel("anthropic/claude-3-7-sonnet")).toBe("anthropic");
    expect(deriveProfileNameFromModel("anthropic/claude-3-5-haiku", ["anthropic"])).toBe("anthropic-2");
    expect(deriveProfileNameFromModel("anthropic/claude-3-5-haiku", ["anthropic", "anthropic-2"])).toBe("anthropic-3");
    expect(deriveProfileNameFromModel("deepseek/deepseek-chat")).toBe("deepseek");
    expect(deriveProfileNameFromModel("google/gemini-2.5-pro")).toBe("google");
  });

  it("derives model name when model has no slash", () => {
    expect(deriveProfileNameFromModel("claude-3-7-sonnet")).toBe("claude-3-7-sonnet");
    expect(deriveProfileNameFromModel("gpt-4o")).toBe("gpt-4o");
  });

  it("builds and parses profile TOML", () => {
    const toml = buildCodexProfileToml({ name: "claude", model: "anthropic/claude-3-7-sonnet" });
    expect(toml).toContain('model = "anthropic/claude-3-7-sonnet"');
    expect(toml).toContain('model_provider = "9router"');
    expect(parseCodexProfileModel(toml)).toBe("anthropic/claude-3-7-sonnet");
  });
});

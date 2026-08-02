import { describe, expect, it } from "vitest";
import {
  applyGrokBuildConfig,
  getGrokSubagentSlot,
  parseGrokBuildConfig,
  resetGrokBuildConfig,
} from "../../src/lib/grokBuildConfig.js";

const BASE_CONFIG = `[cli]
installer = "internal"

[ui]
yolo = false

[models]
default = "grok-4.5"
default_reasoning_effort = "high"

[subagents]
enabled = true

[subagents.models]
general-purpose = "grok-4.5"
explore = "grok-build"
plan = "grok-4.5"

[mcp_servers.example]
url = "https://example.com/mcp"
enabled = true
`;

const APPLY_INPUT = {
  baseUrl: "http://127.0.0.1:20128/v1",
  apiKey: "sk-test",
  model: "cx/gpt-5.6-sol",
  contextWindow: 400000,
  subagentModels: {
    "general-purpose": { model: "cc/claude-sonnet-5", contextWindow: 1000000 },
    explore: { model: "gemini/gemini-3-flash", contextWindow: 1048576 },
  },
};

describe("grokBuildConfig", () => {
  it("creates independent main and per-type subagent model slots", () => {
    const result = applyGrokBuildConfig(BASE_CONFIG, APPLY_INPUT);
    const parsed = parseGrokBuildConfig(result);

    expect(parsed.default).toBe("9router");
    expect(parsed.model).toMatchObject({
      model: "cx/gpt-5.6-sol",
      base_url: "http://127.0.0.1:20128/v1",
      context_window: 400000,
    });
    expect(parsed.subagentMappings).toMatchObject({
      "general-purpose": "9router-general-purpose",
      explore: "9router-explore",
      plan: "grok-4.5",
    });
    expect(parsed.subagentModels["general-purpose"]).toMatchObject({
      model: "cc/claude-sonnet-5",
      context_window: 1000000,
    });
    expect(parsed.subagentModels.explore).toMatchObject({
      model: "gemini/gemini-3-flash",
      context_window: 1048576,
    });
    expect(parsed.subagentModels.plan).toBeNull();
  });

  it("preserves unrelated config sections", () => {
    const result = applyGrokBuildConfig(BASE_CONFIG, APPLY_INPUT);
    expect(result).toContain("[cli]\ninstaller = \"internal\"");
    expect(result).toContain("[ui]\nyolo = false");
    expect(result).toContain("default_reasoning_effort = \"high\"");
    expect(result).toContain("[mcp_servers.example]");
    expect(result).toContain("url = \"https://example.com/mcp\"");
  });

  it("is idempotent and updates owned slots without duplicate sections", () => {
    let result = applyGrokBuildConfig(BASE_CONFIG, APPLY_INPUT);
    result = applyGrokBuildConfig(result, {
      ...APPLY_INPUT,
      model: "cc/claude-opus-4.8",
      contextWindow: 1000000,
      subagentModels: {
        ...APPLY_INPUT.subagentModels,
        explore: { model: "mimo/mimo", contextWindow: 262144 },
      },
    });

    expect(result.match(/^\[model\.9router\]$/gm)).toHaveLength(1);
    expect(result.match(/^\[model\.9router-general-purpose\]$/gm)).toHaveLength(1);
    expect(result.match(/^\[model\.9router-explore\]$/gm)).toHaveLength(1);
    expect(result.match(/^# 9router-prev-subagent-explore/gm)).toHaveLength(1);
    expect(parseGrokBuildConfig(result).model).toMatchObject({
      model: "cc/claude-opus-4.8",
      context_window: 1000000,
    });
    expect(parseGrokBuildConfig(result).subagentModels.explore).toMatchObject({
      model: "mimo/mimo",
      context_window: 262144,
    });
  });

  it("blank override restores previous subagent mapping and removes owned slot", () => {
    let result = applyGrokBuildConfig(BASE_CONFIG, APPLY_INPUT);
    result = applyGrokBuildConfig(result, {
      ...APPLY_INPUT,
      subagentModels: {
        "general-purpose": APPLY_INPUT.subagentModels["general-purpose"],
        // explore omitted => inherit / restore previous
      },
    });

    const parsed = parseGrokBuildConfig(result);
    expect(parsed.subagentMappings.explore).toBe("grok-build");
    expect(parsed.subagentModels.explore).toBeNull();
    expect(result).not.toContain("[model.9router-explore]");
    expect(parsed.subagentMappings["general-purpose"]).toBe("9router-general-purpose");
  });

  it("reset restores previous default and all previous subagent mappings", () => {
    const applied = applyGrokBuildConfig(BASE_CONFIG, APPLY_INPUT);
    const reset = resetGrokBuildConfig(applied);
    const parsed = parseGrokBuildConfig(reset);

    expect(parsed.default).toBe("grok-4.5");
    expect(parsed.model).toBeNull();
    expect(parsed.subagentMappings).toEqual({
      "general-purpose": "grok-4.5",
      explore: "grok-build",
      plan: "grok-4.5",
    });
    expect(reset).not.toContain("[model.9router-");
    expect(reset).not.toContain("9router-prev-");
    expect(reset).toContain("[mcp_servers.example]");
  });

  it("removes mappings that were originally unset", () => {
    const config = `[models]\ndefault = "grok-build"\n\n[mcp_servers.x]\nenabled = true\n`;
    const applied = applyGrokBuildConfig(config, {
      ...APPLY_INPUT,
      subagentModels: {
        plan: { model: "cc/claude-sonnet-5", contextWindow: 1000000 },
      },
    });
    const reset = resetGrokBuildConfig(applied);

    expect(parseGrokBuildConfig(applied).subagentMappings.plan).toBe("9router-plan");
    expect(parseGrokBuildConfig(reset).subagentMappings.plan).toBeNull();
    expect(reset).not.toContain("[subagents.models]");
    expect(reset).toContain("[mcp_servers.x]");
  });

  it("legacy callers without subagentModels leave existing overrides untouched", () => {
    const applied = applyGrokBuildConfig(BASE_CONFIG, APPLY_INPUT);
    const updatedMainOnly = applyGrokBuildConfig(applied, {
      baseUrl: APPLY_INPUT.baseUrl,
      apiKey: APPLY_INPUT.apiKey,
      model: "gemini/gemini-3.1-pro",
      contextWindow: 1048576,
    });

    const parsed = parseGrokBuildConfig(updatedMainOnly);
    expect(parsed.model.model).toBe("gemini/gemini-3.1-pro");
    expect(parsed.subagentMappings.explore).toBe("9router-explore");
    expect(parsed.subagentModels.explore.model).toBe("gemini/gemini-3-flash");
  });

  it("returns stable slot names only for supported subagent types", () => {
    expect(getGrokSubagentSlot("general-purpose")).toBe("9router-general-purpose");
    expect(getGrokSubagentSlot("explore")).toBe("9router-explore");
    expect(getGrokSubagentSlot("plan")).toBe("9router-plan");
    expect(getGrokSubagentSlot("unknown")).toBeNull();
  });
});

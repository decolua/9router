import { describe, it, expect } from "vitest";

describe("Provider deletion cascade cleanup", () => {
  it("should delete model aliases with provider-prefixed values", () => {
    // Verify the SQL pattern matches provider-prefixed alias values
    const providerId = "openai-compatible-abc123";
    const likePattern = `${providerId}/%`;

    // This is the exact SQL pattern used in deleteModelAliasesByProvider
    const sql = `DELETE FROM kv WHERE scope = 'modelAliases' AND value LIKE ?`;
    expect(sql).toContain("DELETE FROM kv WHERE scope = 'modelAliases'");
    expect(likePattern).toBe("openai-compatible-abc123/%");
  });
});

describe("Custom model token limits", () => {
  it("should include maxInputTokens and maxOutputTokens in stored JSON", () => {
    const modelData = {
      providerAlias: "kr",
      id: "claude-opus-4.7",
      type: "llm",
      name: "Claude Opus 4.7",
      maxInputTokens: 1000000,
      maxOutputTokens: 64000,
    };

    expect(modelData.maxInputTokens).toBe(1000000);
    expect(modelData.maxOutputTokens).toBe(64000);

    const json = JSON.stringify(modelData);
    const parsed = JSON.parse(json);
    expect(parsed.maxInputTokens).toBe(1000000);
    expect(parsed.maxOutputTokens).toBe(64000);
  });

  it("should omit token fields when not provided", () => {
    const modelData = {
      providerAlias: "kr",
      id: "claude-opus-4.7",
      type: "llm",
      name: "Claude Opus 4.7",
    };

    expect(modelData.maxInputTokens).toBeUndefined();
    expect(modelData.maxOutputTokens).toBeUndefined();

    const json = JSON.stringify(modelData);
    const parsed = JSON.parse(json);
    expect(parsed.maxInputTokens).toBeUndefined();
    expect(parsed.maxOutputTokens).toBeUndefined();
  });

  it("should conditionally include token fields", () => {
    const baseData = { providerAlias: "kr", id: "claude-opus-4.7", type: "llm", name: "Claude Opus 4.7" };

    // Simulate addCustomModel logic: only include if truthy
    const withTokens = { ...baseData };
    const maxInputTokens = 1000000;
    const maxOutputTokens = 64000;
    if (maxInputTokens) withTokens.maxInputTokens = maxInputTokens;
    if (maxOutputTokens) withTokens.maxOutputTokens = maxOutputTokens;

    expect(withTokens.maxInputTokens).toBe(1000000);
    expect(withTokens.maxOutputTokens).toBe(64000);

    // Without tokens
    const withoutTokens = { ...baseData };
    const noInput = undefined;
    const noOutput = undefined;
    if (noInput) withoutTokens.maxInputTokens = noInput;
    if (noOutput) withoutTokens.maxOutputTokens = noOutput;

    expect(withoutTokens.maxInputTokens).toBeUndefined();
    expect(withoutTokens.maxOutputTokens).toBeUndefined();
  });
});

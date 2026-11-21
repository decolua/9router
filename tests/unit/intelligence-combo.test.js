import { describe, expect, it } from "vitest";

import {
  parseLeaderboardModelsFromHtml,
  matchModelsWithLeaderboard,
  selectIntelligenceModels,
  validateIntelligenceConfig,
} from "../../src/lib/services/artificialAnalysis.js";

const leaderboardHtml = String.raw`<script>self.__next_f.push([1,"[{\"slug\":\"gpt-5\",\"name\":\"GPT-5\",\"intelligenceIndex\":70.12,\"modelCreatorName\":\"OpenAI\"},{\"slug\":\"claude-sonnet-4-5\",\"name\":\"Claude Sonnet 4.5\",\"intelligenceIndex\":66.4,\"modelCreatorName\":\"Anthropic\",\"deprecated\":false},{\"slug\":\"legacy-model\",\"name\":\"Legacy Model\",\"intelligenceIndex\":88,\"deprecated\":true}],\"messages\""]);</script>`;

describe("Artificial Analysis intelligence combos", () => {
  it("parses the embedded leaderboard payload and drops deprecated entries", () => {
    expect(parseLeaderboardModelsFromHtml(leaderboardHtml)).toEqual([
      expect.objectContaining({
        slug: "gpt-5",
        name: "GPT-5",
        intelligenceIndex: 70.12,
        modelCreatorName: "OpenAI",
      }),
      expect.objectContaining({
        slug: "claude-sonnet-4-5",
        intelligenceIndex: 66.4,
        modelCreatorName: "Anthropic",
      }),
    ]);
  });

  it("selects configured available models in descending intelligence order within an inclusive range", () => {
    const leaderboard = parseLeaderboardModelsFromHtml(leaderboardHtml);

    expect(selectIntelligenceModels({
      aaModels: leaderboard,
      availableModels: [
        { id: "anthropic/claude-sonnet-4-5" },
        { id: "openai/gpt-5" },
        { id: "openai/gpt-4o" },
      ],
      config: { minScore: 66.4, maxScore: 70.12, limit: 5 },
    })).toEqual({
      models: ["openai/gpt-5", "anthropic/claude-sonnet-4-5"],
      details: [
        expect.objectContaining({ model: "openai/gpt-5", score: 70.12 }),
        expect.objectContaining({ model: "anthropic/claude-sonnet-4-5", score: 66.4 }),
      ],
    });
  });

  it("matches a dated provider route to its stable leaderboard model family", () => {
    expect(selectIntelligenceModels({
      aaModels: [{ slug: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", intelligenceIndex: 63.5 }],
      availableModels: [{ id: "anthropic/claude-3-7-sonnet-20250219" }],
      config: { minScore: 60, maxScore: 70 },
    }).models).toEqual(["anthropic/claude-3-7-sonnet-20250219"]);
  });

  it("matches a provider route carrying a bracketed context-window tag", () => {
    expect(selectIntelligenceModels({
      aaModels: [{ slug: "gpt-6-astra", name: "GPT-6 Astra (Max)", intelligenceIndex: 52.67 }],
      availableModels: [{ id: "gpt-6-astra[1m]" }],
      config: { minScore: 44, maxScore: 75 },
    }).models).toEqual(["gpt-6-astra[1m]"]);
  });

  it("matches a version-less provider alias to the versioned leaderboard family", () => {
    expect(selectIntelligenceModels({
      aaModels: [{ slug: "gpt-6-astra", name: "GPT-6 Astra (Max)", intelligenceIndex: 52.67 }],
      availableModels: [{ id: "~openai/gpt-astra-latest" }],
      config: { minScore: 44, maxScore: 75 },
    }).models).toEqual(["~openai/gpt-astra-latest"]);
  });

  it("matches a provider route with an embedded creator prefix", () => {
    expect(selectIntelligenceModels({
      aaModels: [{ slug: "gpt-6-astra", name: "GPT-6 Astra (Max)", intelligenceIndex: 52.67 }],
      availableModels: [
        { id: "venice/openai-gpt-6-astra" },
        { id: "bedrock/us.openai.gpt-6-astra" },
      ],
      config: { minScore: 44, maxScore: 75 },
    }).models).toEqual(["venice/openai-gpt-6-astra", "bedrock/us.openai.gpt-6-astra"]);
  });

  it("selects every configured provider route for a matching leaderboard family", () => {
    expect(selectIntelligenceModels({
      aaModels: [{ slug: "deepseek-v4-pro", name: "DeepSeek V4 Pro", intelligenceIndex: 50.0 }],
      availableModels: [
        { id: "ds/deepseek-v4-pro" },
        { id: "ds/deepseek-v4-pro-max" },
        { id: "nvidia/deepseek-ai/deepseek-v4-pro" },
        { id: "xai/grok-4-7" },
      ],
      config: { minScore: 35, maxScore: 75 },
    }).models).toEqual([
      "ds/deepseek-v4-pro",
      "ds/deepseek-v4-pro-max",
      "nvidia/deepseek-ai/deepseek-v4-pro",
    ]);
  });

  it("skips provider routes whose names contain excluded keywords", () => {
    expect(selectIntelligenceModels({
      aaModels: [{ slug: "gpt-5-6-terra", name: "GPT-5.6 Terra", intelligenceIndex: 42.08 }],
      availableModels: [
        { id: "cx/gpt-5.6-terra[1m]" },
        { id: "kr/gpt-5.6-terra-agentic" },
        { id: "kr/gpt-5.6-terra-thinking-agentic" },
        { id: "kr/gpt-5.6-terra-thinking" },
        { id: "kr/gpt-5.6-terra" },
      ],
      config: { minScore: 35, maxScore: 75, excludeKeywords: ["agentic", "thinking", "[1m]"] },
    }).models).toEqual(["kr/gpt-5.6-terra"]);
  });

  it("does not match provider models whose version numbers conflict", () => {
    expect(selectIntelligenceModels({
      aaModels: [
        { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", intelligenceIndex: 56.0 },
        { slug: "grok-4-7", name: "Grok 4.7", intelligenceIndex: 46.4 },
      ],
      availableModels: [
        { id: "anthropic/claude-sonnet-4-5" },
        { id: "xai/grok-4-6" },
      ],
      config: { minScore: 40, maxScore: 75 },
    }).models).toEqual([]);
  });

  it("does not fuzzy-match a one-token family name onto a different model line", () => {
    expect(selectIntelligenceModels({
      aaModels: [{ slug: "qwen3-8-max", name: "Qwen3.8 Max", intelligenceIndex: 45.4 }],
      availableModels: [{ id: "qwen/qwen3-next-80b-a3b-instruct" }],
      config: { minScore: 40, maxScore: 75 },
    }).models).toEqual([]);
  });

  it("normalizes exclusion keywords when validating the config", () => {
    expect(validateIntelligenceConfig({
      minScore: 35,
      maxScore: 75,
      excludeKeywords: [" agentic ", "", "Thinking", 42],
    })).toMatchObject({ excludeKeywords: ["agentic", "Thinking"] });
    expect(validateIntelligenceConfig({ minScore: 35, maxScore: 75 })).toMatchObject({ excludeKeywords: [] });
  });

  it("rejects blank score inputs instead of coercing them to zero", () => {
    expect(() => selectIntelligenceModels({
      aaModels: [],
      availableModels: [],
      config: { minScore: "", maxScore: 75 },
    })).toThrow("Intelligence scores must be numbers");
    expect(() => selectIntelligenceModels({
      aaModels: [],
      availableModels: [],
      config: { minScore: 44, maxScore: "" },
    })).toThrow("Intelligence scores must be numbers");
  });

  it("rejects a reversed intelligence range instead of silently creating an empty combo", () => {
    expect(() => selectIntelligenceModels({
      aaModels: [],
      availableModels: [],
      config: { minScore: 70, maxScore: 60 },
    })).toThrow("Minimum intelligence score cannot exceed maximum score");
  });
});

describe("matcher hardening from independent review", () => {
  it("rejects blank score inputs passed straight to the raw matcher", () => {
    expect(() => matchModelsWithLeaderboard({
      aaModels: [],
      availableModels: [],
      minScore: "",
      maxScore: 75,
    })).toThrow("Minimum intelligence score must be a number");
    expect(() => matchModelsWithLeaderboard({
      aaModels: [],
      availableModels: [],
      minScore: 44,
      maxScore: "  ",
    })).toThrow("Maximum intelligence score must be a number");
  });

  it("matches a dated route that also carries a creator/region prefix", () => {
    const result = matchModelsWithLeaderboard({
      aaModels: [{ slug: "claude-3-7-sonnet", intelligenceIndex: 63.5 }],
      availableModels: ["bedrock/us.anthropic.claude-3-7-sonnet-20250219"],
      minScore: 60,
      maxScore: 70,
    });
    expect(result.models).toEqual(["bedrock/us.anthropic.claude-3-7-sonnet-20250219"]);
  });

  it("treats v-prefixed and bare version tokens as the same version", () => {
    const result = matchModelsWithLeaderboard({
      aaModels: [{ slug: "deepseek-v4-flash", intelligenceIndex: 34 }],
      availableModels: ["ds/deepseek-4-flash"],
      minScore: 30,
      maxScore: 40,
    });
    expect(result.models).toEqual(["ds/deepseek-4-flash"]);
  });

  it("excludes a score that displays below the range minimum", () => {
    const result = matchModelsWithLeaderboard({
      aaModels: [{ slug: "glm-5-3", intelligenceIndex: 44.4 }],
      availableModels: ["kr/glm-5.3"],
      minScore: 45,
      maxScore: 75,
    });
    expect(result.models).toEqual([]);
  });

  it("excludes a score that displays above the range maximum", () => {
    const result = matchModelsWithLeaderboard({
      aaModels: [{ slug: "glm-5-3", intelligenceIndex: 45.6 }],
      availableModels: ["kr/glm-5.3"],
      minScore: 35,
      maxScore: 45,
    });
    expect(result.models).toEqual([]);
  });
});

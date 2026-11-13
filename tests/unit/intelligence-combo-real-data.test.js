import { describe, expect, it } from "vitest";
import { matchModelsWithLeaderboard, validateIntelligenceConfig } from "../../src/lib/services/artificialAnalysis.js";

// Snapshot regression against real-world names:
// - Artificial Analysis leaderboard rows (slug + displayed integer score, 2026-10-08)
// - a real 9router model list (130 provider routes with aliases, brackets, colons,
//   nested namespaces, and -agentic/-thinking/-review variants)
// Both lists drift over time; this fixture freezes today's names so the matcher
// keeps handling them as they change shape.
const AA_ROWS = [
  ["claude-opus-5-5", 58], ["claude-sonnet-5-5", 56], ["claude-opus-5-5-xhigh", 56],
  ["claude-opus-5-5-high", 54], ["claude-fable-5-1", 53], ["claude-fable-5-1-xhigh", 53],
  ["gpt-6-astra", 53], ["gemini-4-argon", 53], ["gpt-6-astra-xhigh", 52],
  ["claude-sonnet-5-5-xhigh", 52], ["gpt-6-1-sol", 52], ["claude-opus-5-5-medium", 51],
  ["claude-fable-5-1-high", 51], ["gpt-6-1-sol-xhigh", 51], ["gpt-6-astra-high", 51],
  ["claude-opus-5", 51], ["gpt-6-1-sol-high", 50], ["gpt-6-astra-medium", 50],
  ["claude-fable-5", 50], ["claude-fable-5-1-medium", 49], ["muse-spark-1-3", 48],
  ["gpt-6-1-sol-medium", 48], ["gpt-6-sol", 48], ["claude-fable-5-1-low", 47],
  ["claude-sonnet-5-5-high", 47], ["gpt-5-6-sol", 47], ["grok-4-7", 46],
  ["grok-4-7-high", 46], ["mimo-v2-6-pro", 46], ["gpt-6-astra-low", 46],
  ["qwen3-8-max", 45], ["muse-spark-1-3-xhigh", 45], ["glm-5-3", 45],
  ["claude-opus-5-medium", 45], ["kimi-k3", 44], ["step-5", 44],
  ["gpt-5-6-sol-xhigh", 44], ["gpt-6-sol-xhigh", 44], ["grok-4-6", 44],
  ["claude-haiku-5-5", 43], ["claude-opus-5-5-low", 42], ["grok-4-7-low", 42],
  ["gpt-6-1-sol-low", 42], ["gpt-5-6-terra", 42], ["glm-5-3-flash", 42],
  ["claude-opus-4-8", 42], ["gpt-5-6-sol-high", 42], ["claude-haiku-5-5-xhigh", 41],
  ["gemini-3-8-flash", 41], ["claude-sonnet-5-5-medium", 41], ["claude-opus-4-7", 41],
  ["qwen3-8-2-4t-a95b", 40], ["qwen3-8-flash-next", 40], ["muse-spark-1-2", 40],
  ["gemini-3-8-flash-medium", 40], ["gpt-6-sol-medium", 40], ["deepseek-v4-1-flash", 39],
  ["gemini-3-7-flash", 39], ["gpt-5-4", 39], ["grok-4-5", 39], ["gpt-5-6-sol-medium", 39],
  ["mistral-large-4", 38], ["gpt-6-luna", 38], ["gpt-5-6-terra-xhigh", 38],
  ["mimo-v2-6-flash", 38], ["claude-haiku-5-5-high", 38], ["claude-sonnet-5", 38],
  ["gpt-5-5", 38], ["gpt-5-5-high", 37], ["gpt-5-6-luna", 37], ["gemini-3-7-flash-low", 37],
  ["deepseek-v4-pro", 36], ["claude-sonnet-5-5-low", 36], ["deepseek-v4-flash-vision", 35],
  ["gpt-6-luna-xhigh", 35], ["gpt-5-6-luna-xhigh", 35], ["grok-4-6-low", 35],
  ["deepseek-v4-flash", 34], ["glm-5-2", 34], ["gpt-5-6-terra-high", 34],
  ["gemini-3-6-flash", 34], ["gpt-6-luna-high", 33], ["gpt-5-6-luna-high", 32],
  ["gpt-5-5-low", 31], ["kimi-k3-low", 30], ["gpt-5-6-terra-medium", 30],
].map(([slug, intelligenceIndex]) => ({ slug, intelligenceIndex }));

const ROUTES = [
  "cc/claude-haiku-4-5-20251001", "cc/claude-fable-5", "cc/claude-opus-5-5",
  "cc/claude-fable-5-1", "cc/claude-sonnet-5", "cc/claude-opus-5", "cc/claude-sonnet-5-5",
  "cx/codex-auto-review", "cx/gpt-5.5", "cx/gpt-6-luna[1m]", "cx/gpt-6-astra[1m]",
  "cx/gpt-5.6-terra-review", "cx/gpt-5.6-terra[1m]", "cx/gpt-5.6-sol-review",
  "cx/gpt-5.6-sol[1m]", "cx/gpt-5.6-luna-review", "cx/gpt-5.6-luna[1m]", "cx/gpt-5.5-review",
  "ds/deepseek-v4.1-flash", "ds/deepseek-v4-pro-none", "ds/deepseek-v4-pro",
  "ds/deepseek-v4-flash-vision-exp", "ds/deepseek-v4-flash", "ds/deepseek-reasoner",
  "ds/deepseek-chat", "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
  "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "openrouter/nvidia/nemotron-3-nano-30b-a3b:free", "openrouter/tencent/hy3-preview:free",
  "openrouter/openrouter/free", "openrouter/openrouter/owl-alpha", "ollama/minimax-m2.5",
  "ollama/gpt-oss:120b", "ollama/deepseek-v4.1-flash:cloud", "ollama/minimax-m3",
  "nvidia/nvidia/nemotron-3-ultra-550b-a55b", "nvidia/deepseek-ai/deepseek-v4-flash",
  "nvidia/minimaxai/minimax-m3", "nvidia/minimaxai/minimax-m2.7",
  "nvidia/google/gemma-4-31b-it", "nvidia/moonshotai/kimi-k2.6", "nvidia/z-ai/glm-5.2",
  "nvidia/deepseek-ai/deepseek-v4-pro", "gemini/gemini-3.7-flash",
  "gemini/gemini-3.5-flash-lite", "gemini/gemini-3.1-pro-preview",
  "gemini/gemini-3-flash-preview", "gemini/gemini-2.5-flash-lite", "gemini/gemini-2.5-flash",
  "gemini/gemini-3.6-flash", "gemini/gemini-2.5-pro", "gemini/gemini-3.8-flash",
  "cf/@cf/qwen/qwen2.5-coder-32b-instruct", "cf/@cf/mistralai/mistral-small-3.1-24b-instruct",
  "cf/@cf/meta/llama-3.2-3b-instruct", "cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast",
  "cf/@cf/meta/llama-3.1-8b-instruct-awq", "cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast",
  "cf/@cf/moonshotai/kimi-k2.6", "cf/@cf/meta/llama-3.2-1b-instruct",
  "cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast", "cf/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "cf/@cf/zai-org/glm-4.7-flash", "cf/@cf/moonshotai/kimi-k2.5", "cf/@cf/qwen/qwq-32b",
  "oc/union-alpha", "oc/muse-spark-1.3-contributor-free", "oc/muse-spark-1.2-contributor-free",
  "mmf/mimo-auto", "kr/claude-haiku-4.5", "kr/claude-haiku-4.5-agentic",
  "kr/claude-haiku-4.5-thinking-agentic", "kr/claude-opus-4.5-thinking",
  "kr/claude-opus-4.5-thinking-agentic", "kr/claude-opus-4.5-agentic", "kr/claude-opus-4.5",
  "kr/claude-opus-4.7-thinking-agentic", "kr/claude-opus-4.7-agentic", "kr/claude-opus-4.7",
  "kr/claude-haiku-4.5-thinking", "kr/claude-opus-5", "kr/claude-opus-5-agentic",
  "kr/claude-opus-4.8-thinking-agentic", "kr/claude-opus-4.8-agentic", "kr/claude-opus-4.8",
  "kr/claude-opus-4.7-thinking", "kr/claude-sonnet-4.5-thinking-agentic",
  "kr/claude-sonnet-4.5-agentic", "kr/claude-sonnet-4.5", "kr/claude-opus-5.5-thinking",
  "kr/claude-opus-5.5-thinking-agentic", "kr/claude-opus-5.5-agentic", "kr/claude-opus-5.5",
  "kr/claude-opus-5-thinking", "kr/claude-opus-5-thinking-agentic", "kr/claude-opus-4.8-thinking",
  "kr/gpt-5.6-luna", "kr/claude-sonnet-5-thinking", "kr/claude-sonnet-5-thinking-agentic",
  "kr/claude-sonnet-5-agentic", "kr/claude-sonnet-5", "kr/claude-sonnet-4.5-thinking",
  "kr/deepseek-3.2", "kr/gpt-5.6-terra-thinking-agentic", "kr/gpt-5.6-terra-agentic",
  "kr/gpt-5.6-sol-thinking", "kr/gpt-5.6-sol-thinking-agentic", "kr/gpt-5.6-sol-agentic",
  "kr/gpt-5.6-luna-thinking", "kr/gpt-5.6-luna-thinking-agentic", "kr/gpt-5.6-luna-agentic",
  "kr/glm-5", "kr/gpt-5.6-terra-thinking", "kr/gpt-5.6-terra", "kr/gpt-5.6-sol",
  "kr/qwen3-coder-next", "mimo/mimo-v2.6-flash", "mimo/mimo-v2.5-pro", "mimo/mimo-v2.5",
  "mimo/mimo-v2.6-pro", "cx/gpt-6.1-sol", "cx/gpt-6-sol[1m]", "cx/gpt-6-sol", "cx/gpt-6-astra",
  "cx/gpt-6-luna", "cx/gpt-5.6-sol", "cx/gpt-5.6-terra", "cx/gpt-daybreak-blue-latest",
  "cx/gpt-reserve", "cx/gpt-5.6-luna",
].map((id) => ({ id }));

const AVAILABLE = ROUTES.map((r) => r.id).sort();

const EXPECTED_45_75 = [
  "cc/claude-fable-5", "cc/claude-fable-5-1", "cc/claude-opus-5", "cc/claude-opus-5-5",
  "cc/claude-sonnet-5-5", "cx/gpt-5.6-sol", "cx/gpt-5.6-sol-review", "cx/gpt-5.6-sol[1m]",
  "cx/gpt-6-astra", "cx/gpt-6-astra[1m]", "cx/gpt-6-sol", "cx/gpt-6-sol[1m]", "cx/gpt-6.1-sol",
  "kr/claude-opus-5", "kr/claude-opus-5-agentic", "kr/claude-opus-5-thinking",
  "kr/claude-opus-5-thinking-agentic", "kr/claude-opus-5.5", "kr/claude-opus-5.5-agentic",
  "kr/claude-opus-5.5-thinking", "kr/claude-opus-5.5-thinking-agentic", "kr/gpt-5.6-sol",
  "kr/gpt-5.6-sol-agentic", "kr/gpt-5.6-sol-thinking", "kr/gpt-5.6-sol-thinking-agentic",
  "mimo/mimo-v2.6-pro", "oc/muse-spark-1.3-contributor-free",
].sort();

const EXPECTED_35_75 = [
  "cc/claude-fable-5", "cc/claude-fable-5-1", "cc/claude-opus-5", "cc/claude-opus-5-5",
  "cc/claude-sonnet-5", "cc/claude-sonnet-5-5", "cx/gpt-5.5", "cx/gpt-5.5-review",
  "cx/gpt-5.6-luna", "cx/gpt-5.6-luna-review", "cx/gpt-5.6-luna[1m]", "cx/gpt-5.6-sol",
  "cx/gpt-5.6-sol-review", "cx/gpt-5.6-sol[1m]", "cx/gpt-5.6-terra", "cx/gpt-5.6-terra-review",
  "cx/gpt-5.6-terra[1m]", "cx/gpt-6-astra", "cx/gpt-6-astra[1m]", "cx/gpt-6-luna",
  "cx/gpt-6-luna[1m]", "cx/gpt-6-sol", "cx/gpt-6-sol[1m]", "cx/gpt-6.1-sol",
  "ds/deepseek-v4-flash-vision-exp", "ds/deepseek-v4-pro", "ds/deepseek-v4-pro-none",
  "ds/deepseek-v4.1-flash", "gemini/gemini-3.7-flash", "gemini/gemini-3.8-flash",
  "kr/claude-opus-4.7", "kr/claude-opus-4.7-agentic", "kr/claude-opus-4.7-thinking",
  "kr/claude-opus-4.7-thinking-agentic", "kr/claude-opus-4.8", "kr/claude-opus-4.8-agentic",
  "kr/claude-opus-4.8-thinking", "kr/claude-opus-4.8-thinking-agentic", "kr/claude-opus-5",
  "kr/claude-opus-5-agentic", "kr/claude-opus-5-thinking", "kr/claude-opus-5-thinking-agentic",
  "kr/claude-opus-5.5", "kr/claude-opus-5.5-agentic", "kr/claude-opus-5.5-thinking",
  "kr/claude-opus-5.5-thinking-agentic", "kr/claude-sonnet-5", "kr/claude-sonnet-5-agentic",
  "kr/claude-sonnet-5-thinking", "kr/claude-sonnet-5-thinking-agentic", "kr/gpt-5.6-luna",
  "kr/gpt-5.6-luna-agentic", "kr/gpt-5.6-luna-thinking", "kr/gpt-5.6-luna-thinking-agentic",
  "kr/gpt-5.6-sol", "kr/gpt-5.6-sol-agentic", "kr/gpt-5.6-sol-thinking",
  "kr/gpt-5.6-sol-thinking-agentic", "kr/gpt-5.6-terra", "kr/gpt-5.6-terra-agentic",
  "kr/gpt-5.6-terra-thinking", "kr/gpt-5.6-terra-thinking-agentic", "mimo/mimo-v2.6-flash",
  "mimo/mimo-v2.6-pro", "nvidia/deepseek-ai/deepseek-v4-pro",
  "oc/muse-spark-1.2-contributor-free", "oc/muse-spark-1.3-contributor-free",
  "ollama/deepseek-v4.1-flash:cloud",
].sort();

function select(minScore, maxScore, options = {}) {
  return matchModelsWithLeaderboard({
    aaModels: AA_ROWS,
    availableModels: options.availableModels || ROUTES,
    minScore,
    maxScore,
    ...options.config,
  }).models.sort();
}

describe("intelligence matching against the real AA + 9router model lists", () => {
  it("selects every expected route for range 45-75", () => {
    expect(select(45, 75)).toEqual(EXPECTED_45_75);
  });

  it("selects every expected route for range 35-75", () => {
    expect(select(35, 75)).toEqual(EXPECTED_35_75);
  });

  it("includes every route the user reported as missing at 35-75", () => {
    const selected = new Set(select(35, 75));
    for (const route of [
      "nvidia/deepseek-ai/deepseek-v4-pro",
      "ds/deepseek-v4-pro",
      "ds/deepseek-v4-pro-none",
      "mimo/mimo-v2.6-flash",
      "mimo/mimo-v2.6-pro",
      "cx/gpt-5.6-terra[1m]",
      "kr/gpt-5.6-terra-agentic",
      "kr/gpt-5.6-terra-thinking-agentic",
      "kr/gpt-5.6-terra-thinking",
      "kr/gpt-5.6-terra",
      "cx/gpt-6-luna",
      "cx/gpt-6-luna[1m]",
    ]) {
      expect(selected.has(route), `${route} should be selected`).toBe(true);
    }
  });

  it("does not let DeepSeek V4 Flash inherit the V4.1 Flash score", () => {
    const selected = new Set(select(35, 75));
    expect(selected.has("ds/deepseek-v4-flash")).toBe(false);
    expect(selected.has("nvidia/deepseek-ai/deepseek-v4-flash")).toBe(false);
  });

  it("includes a score that displays as the range minimum (AA rounds 44.78 to 45)", () => {
    const result = matchModelsWithLeaderboard({
      aaModels: [{ slug: "glm-5-3", intelligenceIndex: 44.78 }],
      availableModels: [{ id: "kr/glm-5.3" }],
      minScore: 45,
      maxScore: 75,
    });
    expect(result.models).toEqual(["kr/glm-5.3"]);
  });

  it("honors exclusion keywords over the real names", () => {
    const config = validateIntelligenceConfig({
      minScore: 35,
      maxScore: 75,
      excludeKeywords: ["[1m]", "agentic", "thinking"],
    });
    const selected = select(35, 75, { config });
    for (const route of selected) {
      expect(route).not.toMatch(/\[1m\]|agentic|thinking/i);
    }
    expect(selected).toContain("kr/gpt-5.6-terra");
    expect(selected).toContain("cx/gpt-6-luna");
  });
});

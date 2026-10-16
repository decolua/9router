import { describe, it, expect } from "vitest";
import {
  parseSearchQuery,
  matchesSearch,
  filterModelsByQuery,
} from "../../src/shared/utils/modelSearchFilter.js";

describe("modelSearchFilter utility", () => {
  const sampleModels = [
    { id: "gpt-4o", name: "GPT-4o", value: "openai/gpt-4o", provider: "openai" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", value: "openai/gpt-4o-mini", provider: "openai" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", value: "anthropic/claude-3-5-sonnet", provider: "anthropic" },
    { id: "claude-3-haiku", name: "Claude 3 Haiku", value: "anthropic/claude-3-haiku", provider: "anthropic" },
    { id: "text-embedding-3-small", name: "Text Embedding 3 Small", value: "openai/text-embedding-3-small", provider: "openai" },
    { id: "oc/muse-spark", name: "Muse Spark Free", value: "oc/muse-spark", provider: "opencode" },
  ];

  describe("parseSearchQuery", () => {
    it("handles empty or whitespace query", () => {
      expect(parseSearchQuery("").isEmpty).toBe(true);
      expect(parseSearchQuery("   ").isEmpty).toBe(true);
      expect(parseSearchQuery(null).isEmpty).toBe(true);
      expect(parseSearchQuery(undefined).isEmpty).toBe(true);
    });

    it("parses positive keywords", () => {
      const q = parseSearchQuery("claude sonnet");
      expect(q.isEmpty).toBe(false);
      expect(q.isRegex).toBe(false);
      expect(q.positiveTerms).toEqual(["claude", "sonnet"]);
      expect(q.negativeTerms).toEqual([]);
    });

    it("parses negative keywords with ! or - prefix", () => {
      const q1 = parseSearchQuery("!embed -preview");
      expect(q1.isEmpty).toBe(false);
      expect(q1.isRegex).toBe(false);
      expect(q1.positiveTerms).toEqual([]);
      expect(q1.negativeTerms).toEqual(["embed", "preview"]);
    });

    it("parses combined positive and negative terms", () => {
      const q = parseSearchQuery("claude !haiku -sonnet");
      expect(q.positiveTerms).toEqual(["claude"]);
      expect(q.negativeTerms).toEqual(["haiku", "sonnet"]);
    });

    it("parses explicit regex /pattern/flags", () => {
      const q = parseSearchQuery("/claude-(3\\.5|sonnet)/i");
      expect(q.isRegex).toBe(true);
      expect(q.regex).toBeInstanceOf(RegExp);
      expect(q.regex.test("claude-3.5")).toBe(true);
      expect(q.regex.test("claude-haiku")).toBe(false);
    });

    it("safely handles unclosed or invalid regex without throwing", () => {
      expect(() => parseSearchQuery("/[unclosed")).not.toThrow();
      const q = parseSearchQuery("/[unclosed");
      expect(q.isEmpty).toBe(false);
    });
  });

  describe("matchesSearch", () => {
    it("matches basic case-insensitive substring", () => {
      expect(matchesSearch("Claude 3.5 Sonnet", "claude")).toBe(true);
      expect(matchesSearch("Claude 3.5 Sonnet", "CLAUDE")).toBe(true);
      expect(matchesSearch("GPT-4o", "claude")).toBe(false);
    });

    it("matches model object by id, name, value, or provider", () => {
      const model = sampleModels[0]; // gpt-4o
      expect(matchesSearch(model, "gpt-4o")).toBe(true);
      expect(matchesSearch(model, "GPT-4o")).toBe(true);
      expect(matchesSearch(model, "openai")).toBe(true);
    });

    it("excludes models matching negation tokens (!term or -term)", () => {
      const sonnet = sampleModels[2];
      const haiku = sampleModels[3];

      expect(matchesSearch(sonnet, "claude !haiku")).toBe(true);
      expect(matchesSearch(haiku, "claude !haiku")).toBe(false);
      expect(matchesSearch(haiku, "claude -haiku")).toBe(false);
    });

    it("supports pure negation queries (!embed)", () => {
      const embedding = sampleModels[4];
      const gpt4 = sampleModels[0];

      expect(matchesSearch(embedding, "!embed")).toBe(false);
      expect(matchesSearch(gpt4, "!embed")).toBe(true);
    });

    it("matches using regular expressions", () => {
      const sonnet = sampleModels[2];
      const haiku = sampleModels[3];

      expect(matchesSearch(sonnet, "/sonnet/i")).toBe(true);
      expect(matchesSearch(haiku, "/sonnet/i")).toBe(false);
    });

    it("supports negative lookahead regex", () => {
      const regexQuery = "/^(?!.*embed).*$/i";
      const embedding = sampleModels[4];
      const gpt4 = sampleModels[0];

      expect(matchesSearch(embedding, regexQuery)).toBe(false);
      expect(matchesSearch(gpt4, regexQuery)).toBe(true);
    });
  });

  describe("filterModelsByQuery", () => {
    it("returns all models for empty query", () => {
      expect(filterModelsByQuery(sampleModels, "")).toEqual(sampleModels);
      expect(filterModelsByQuery(sampleModels, null)).toEqual(sampleModels);
    });

    it("filters models matching a positive query", () => {
      const result = filterModelsByQuery(sampleModels, "claude");
      expect(result.map((m) => m.id)).toEqual(["claude-3-5-sonnet", "claude-3-haiku"]);
    });

    it("filters out excluded models using negation", () => {
      const result = filterModelsByQuery(sampleModels, "!embed");
      expect(result.some((m) => m.id.includes("embedding"))).toBe(false);
      expect(result.length).toBe(5);
    });

    it("filters with combined positive and negative terms", () => {
      const result = filterModelsByQuery(sampleModels, "claude !haiku");
      expect(result.map((m) => m.id)).toEqual(["claude-3-5-sonnet"]);
    });

    it("filters with regex pattern", () => {
      const result = filterModelsByQuery(sampleModels, "/gpt-4o-(mini)/i");
      expect(result.map((m) => m.id)).toEqual(["gpt-4o-mini"]);
    });
  });
});

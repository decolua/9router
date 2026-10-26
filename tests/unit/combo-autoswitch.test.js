import { describe, it, expect } from "vitest";
import { detectRequiredCapabilities, reorderByCapabilities } from "../../open-sse/services/combo.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("detectRequiredCapabilities", () => {
  it("text-only -> empty", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: "hi" }] });
    expect(r.size).toBe(0);
  });

  it("openai image_url -> vision", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "x" } },
    ] }] });
    expect(r.has("vision")).toBe(true);
  });

  it("openai file -> pdf", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: [
      { type: "file", file: { file_data: "data:application/pdf;base64,x" } },
    ] }] });
    expect(r.has("pdf")).toBe(true);
  });

  it("gemini inlineData image -> vision", () => {
    const r = detectRequiredCapabilities({ contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "image/png", data: "x" } },
    ] }] });
    expect(r.has("vision")).toBe(true);
  });

  it("antigravity request.contents image -> vision", () => {
    const r = detectRequiredCapabilities({ request: { contents: [{ role: "user", parts: [
      { inlineData: { mimeType: "image/jpeg", data: "x" } },
    ] }] } });
    expect(r.has("vision")).toBe(true);
  });

  it("web_search tool -> search", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: "q" }], tools: [
      { type: "web_search" },
    ] });
    expect(r.has("search")).toBe(true);
  });

  it("missing tools -> no search", () => {
    const r = detectRequiredCapabilities({ messages: [{ role: "user", content: "q" }] });
    expect(r.has("search")).toBe(false);
    expect(r.size).toBe(0);
  });

  it("malformed tools -> no search", () => {
    const malformed = [
      null,
      "web_search",
      { type: "web_search" },
      [null, "web_search", 42, { type: "function" }, { function: { name: "web_search" } }],
    ];
    for (const tools of malformed) {
      const r = detectRequiredCapabilities({ messages: [{ role: "user", content: "q" }], tools });
      expect(r.has("search")).toBe(false);
      expect(r.size).toBe(0);
    }
  });

  it("unrelated tool -> no search", () => {
    const r = detectRequiredCapabilities({
      messages: [{ role: "user", content: "q" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
    });
    expect(r.has("search")).toBe(false);
    expect(r.size).toBe(0);
  });

  it("web_search variants are not search (exact type only)", () => {
    for (const type of ["web_search_preview", "web_search_20250305"]) {
      const r = detectRequiredCapabilities({ messages: [{ role: "user", content: "q" }], tools: [{ type }] });
      expect(r.has("search")).toBe(false);
      expect(r.size).toBe(0);
    }
  });

  it("responses input_image -> vision", () => {
    const r = detectRequiredCapabilities({ input: [{ role: "user", content: [
      { type: "input_image", image_url: "x" },
    ] }] });
    expect(r.has("vision")).toBe(true);
  });
});

describe("reorderByCapabilities", () => {
  it("no required -> unchanged", () => {
    const models = ["a/x", "b/y"];
    expect(reorderByCapabilities(models, new Set())).toBe(models);
  });

  it("floats vision-capable model to front, keeps fallback", () => {
    // deepseek-chat = no vision; claude-sonnet = vision
    const models = ["deepseek/deepseek-chat", "anthropic/claude-sonnet-4.6"];
    const out = reorderByCapabilities(models, new Set(["vision"]));
    expect(out[0]).toBe("anthropic/claude-sonnet-4.6");
    expect(out).toContain("deepseek/deepseek-chat"); // not dropped
    expect(out).toHaveLength(2);
  });

  it("keeps order when no model matches", () => {
    const models = ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"];
    expect(getCapabilitiesForModel("deepseek", "deepseek-chat").vision).toBe(false);
    expect(getCapabilitiesForModel("deepseek", "deepseek-reasoner").vision).toBe(false);
    const out = reorderByCapabilities(models, new Set(["vision"]));
    expect(out).toStrictEqual(models);
  });

  it("floats search-capable model to front, keeps fallback order", () => {
    const models = ["deepseek/deepseek-chat", "anthropic/claude-sonnet-4.6", "deepseek/deepseek-reasoner"];
    expect(getCapabilitiesForModel("deepseek", "deepseek-chat").search).toBe(false);
    expect(getCapabilitiesForModel("anthropic", "claude-sonnet-4.6").search).toBe(true);
    expect(getCapabilitiesForModel("deepseek", "deepseek-reasoner").search).toBe(false);
    const out = reorderByCapabilities(models, new Set(["search"]));
    expect(out).toStrictEqual(["anthropic/claude-sonnet-4.6", "deepseek/deepseek-chat", "deepseek/deepseek-reasoner"]);
  });

  it("keeps every fallback when no model satisfies search", () => {
    const models = ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"];
    expect(getCapabilitiesForModel("deepseek", "deepseek-chat").search).toBe(false);
    expect(getCapabilitiesForModel("deepseek", "deepseek-reasoner").search).toBe(false);
    const out = reorderByCapabilities(models, new Set(["search"]));
    expect(out).toStrictEqual(models);
  });

  it("single model -> unchanged", () => {
    const models = ["a/x"];
    expect(reorderByCapabilities(models, new Set(["vision"]))).toBe(models);
  });
});

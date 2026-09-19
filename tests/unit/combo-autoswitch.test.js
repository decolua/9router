import { describe, it, expect } from "vitest";
import {
  classifyTask,
  detectRequiredCapabilities,
  getRotatedModels,
  reorderByCapabilities,
  reorderByTaskWeight,
  resetComboRotation,
  scoreModelForTask,
} from "../../open-sse/services/combo.js";

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

  it("responses input_image -> vision", () => {
    const r = detectRequiredCapabilities({ input: [{ role: "user", content: [
      { type: "input_image", image_url: "x" },
    ] }] });
    expect(r.has("vision")).toBe(true);
  });

  it("explicit reasoning request -> reasoning", () => {
    const r = detectRequiredCapabilities({
      messages: [{ role: "user", content: "solve carefully" }],
      reasoning_effort: "high",
    });
    expect(r.has("reasoning")).toBe(true);
  });

  it("large prompt alone is not a capability auto-switch signal", () => {
    const r = detectRequiredCapabilities({
      messages: [{ role: "user", content: "x".repeat(50000) }],
    });
    expect(r.has("reasoning")).toBe(false);
    expect(classifyTask({ messages: [{ role: "user", content: "x".repeat(50000) }] }).level).toBe("heavy");
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
    const out = reorderByCapabilities(models, new Set(["vision"]));
    expect(out).toBe(models);
  });

  it("single model -> unchanged", () => {
    const models = ["a/x"];
    expect(reorderByCapabilities(models, new Set(["vision"]))).toBe(models);
  });

  it("floats reasoning-capable model for heavy requests", () => {
    const models = ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"];
    const out = reorderByCapabilities(models, new Set(["reasoning"]));
    expect(out[0]).toBe("deepseek/deepseek-reasoner");
    expect(out).toContain("deepseek/deepseek-chat");
  });
});

describe("smart task routing", () => {
  it("classifies small simple requests as light", () => {
    const task = classifyTask({ messages: [{ role: "user", content: "translate this short sentence" }], max_tokens: 256 });
    expect(task.level).toBe("light");
  });

  it("classifies security-sensitive tool-heavy requests as critical", () => {
    const task = classifyTask({
      messages: [{ role: "user", content: `Find a critical bug bounty attack chain for RCE or supply chain impact.\n${"context ".repeat(2000)}` }],
      tools: [{ name: "read" }, { name: "grep" }, { name: "web" }, { name: "bash" }],
      reasoning_effort: "high",
      max_tokens: 12000,
    });
    expect(task.level).toBe("critical");
  });

  it("routes light tasks to lighter models before expensive models", () => {
    const models = ["anthropic/claude-opus-4.6", "anthropic/claude-haiku-4.5"];
    const task = classifyTask({ messages: [{ role: "user", content: "quick rewrite this sentence" }], max_tokens: 300 });
    const out = reorderByTaskWeight(models, task, new Set());
    expect(out[0]).toBe("anthropic/claude-haiku-4.5");
  });

  it("routes critical tasks to stronger models before lighter models", () => {
    const models = ["anthropic/claude-haiku-4.5", "anthropic/claude-opus-4.6"];
    const task = classifyTask({
      messages: [{ role: "user", content: `Security review for account takeover and cross-tenant RCE impact.\n${"code ".repeat(3000)}` }],
      tools: [{ name: "read" }, { name: "grep" }, { name: "bash" }, { name: "web" }],
      reasoning_effort: "high",
    });
    const out = reorderByTaskWeight(models, task, new Set(["reasoning"]));
    expect(out[0]).toBe("anthropic/claude-opus-4.6");
    expect(scoreModelForTask(out[0], task, new Set(["reasoning"]))).toBeGreaterThan(scoreModelForTask(out[1], task, new Set(["reasoning"])));
  });

  it("keeps hard capability requirements ahead of light-task cost preference", () => {
    const models = ["deepseek/deepseek-chat", "anthropic/claude-haiku-4.5"];
    const task = classifyTask({ messages: [{ role: "user", content: "what is in this image?" }] });
    const out = reorderByTaskWeight(models, task, new Set(["vision"]));
    expect(out[0]).toBe("anthropic/claude-haiku-4.5");
  });
});

describe("round robin strategy", () => {
  it("rotates every request when sticky limit is 1, even for the same conversation", () => {
    const comboName = `rr-${Date.now()}-pure`;
    const models = ["provider/a", "provider/b", "provider/c"];
    resetComboRotation(comboName);

    expect(getRotatedModels(models, comboName, "round-robin", 1, "same-conversation")[0]).toBe("provider/a");
    expect(getRotatedModels(models, comboName, "round-robin", 1, "same-conversation")[0]).toBe("provider/b");
    expect(getRotatedModels(models, comboName, "round-robin", 1, "same-conversation")[0]).toBe("provider/c");
  });

  it("uses conversation affinity only when sticky limit is above 1", () => {
    const comboName = `rr-${Date.now()}-sticky`;
    const models = ["provider/a", "provider/b", "provider/c"];
    resetComboRotation(comboName);

    expect(getRotatedModels(models, comboName, "round-robin", 2, "same-conversation")[0]).toBe("provider/a");
    expect(getRotatedModels(models, comboName, "round-robin", 2, "same-conversation")[0]).toBe("provider/a");
  });
});

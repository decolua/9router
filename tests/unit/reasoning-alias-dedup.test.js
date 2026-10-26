import test, { describe } from "node:test";
import assert from "node:assert";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("reasoning and reasoning_content alias deduplication (#4841)", () => {
  test("drops reasoning when reasoning_content is already present on assistant message", () => {
    const body = {
      model: "glm-4-plus",
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "Hi there",
          reasoning_content: "Thinking step 1",
          reasoning: "Thinking step 1 (duplicate alias)",
        },
      ],
    };

    const result = stripUnsupportedParams("z-ai", "glm-4-plus", body);
    assert.strictEqual(result.messages[1].reasoning_content, "Thinking step 1");
    assert.strictEqual(result.messages[1].reasoning, undefined);
  });

  test("preserves reasoning when reasoning_content is absent", () => {
    const body = {
      model: "glm-4-plus",
      messages: [
        {
          role: "assistant",
          content: "Thinking only via reasoning field",
          reasoning: "Thinking step",
        },
      ],
    };

    const result = stripUnsupportedParams("z-ai", "glm-4-plus", body);
    assert.strictEqual(result.messages[0].reasoning, "Thinking step");
    assert.strictEqual(result.messages[0].reasoning_content, undefined);
  });

  test("preserves reasoning_content when reasoning is absent", () => {
    const body = {
      model: "glm-4-plus",
      messages: [
        {
          role: "assistant",
          content: "Standard DeepSeek style",
          reasoning_content: "Thinking step",
        },
      ],
    };

    const result = stripUnsupportedParams("z-ai", "glm-4-plus", body);
    assert.strictEqual(result.messages[0].reasoning_content, "Thinking step");
    assert.strictEqual(result.messages[0].reasoning, undefined);
  });

  test("leaves user and system messages untouched", () => {
    const body = {
      model: "kimi-k2",
      messages: [
        {
          role: "user",
          content: "Hello",
          reasoning: "User reasoning notes",
          reasoning_content: "User notes duplicate",
        },
      ],
    };

    const result = stripUnsupportedParams("moonshot", "kimi-k2", body);
    assert.strictEqual(result.messages[0].reasoning, "User reasoning notes");
    assert.strictEqual(result.messages[0].reasoning_content, "User notes duplicate");
  });
});

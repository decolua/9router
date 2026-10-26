import { describe, it, expect } from "vitest";
import { openAICompletionToClaudeMessage } from "../../open-sse/translator/concerns/claudeMessage.js";

// Non-stream /v1/messages over an OpenAI-format upstream must keep the cache split.
const body = (usage) => ({ id: "chatcmpl-1", model: "m", choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage });

describe("openAICompletionToClaudeMessage usage", () => {
  it("reports cached prompt tokens as cache_read_input_tokens", () => {
    const out = openAICompletionToClaudeMessage(body({ prompt_tokens: 25454, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 25408 } }));
    expect(out.usage).toEqual({ input_tokens: 46, output_tokens: 7, cache_read_input_tokens: 25408 });
  });

  it("splits cache writes too", () => {
    const out = openAICompletionToClaudeMessage(body({ prompt_tokens: 1000, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 600, cache_creation_tokens: 300 } }));
    expect(out.usage).toEqual({ input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 600, cache_creation_input_tokens: 300 });
  });

  it("is unchanged without cache data", () => {
    const out = openAICompletionToClaudeMessage(body({ prompt_tokens: 50, completion_tokens: 2 }));
    expect(out.usage).toEqual({ input_tokens: 50, output_tokens: 2 });
  });

  it("passes Claude-shaped usage through", () => {
    const out = openAICompletionToClaudeMessage(body({ input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 90 }));
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 90 });
  });
});

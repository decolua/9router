// The client asked for model X (e.g. claude-opus-5); the upstream provider is
// model Y (e.g. glm-5.3). Responses must echo X, not Y: Anthropic-format
// clients (Claude Code) persist message.model into the session and refuse to
// restore a model they don't recognize.
import { describe, expect, it } from "vitest";
import { translateResponse, initState } from "../../open-sse/translator/index.js";

const completion = { model: "glm-5.3" };

describe("model echo (streaming)", () => {
  it("seeded state.model (client's request) survives provider chunks", () => {
    const state = { ...initState("claude"), model: "claude-opus-5" };
    const events = translateResponse("openai", "claude",
      { id: "chatcmpl-1", object: "chat.completion.chunk", model: "glm-5.3", choices: [{ delta: { content: "hi" } }] }, state);
    const start = events.find(e => e.type === "message_start");
    expect(start.message.model).toBe("claude-opus-5");
  });

  it("falls back to the provider chunk model when state.model is unset", () => {
    const state = initState("claude");
    const events = translateResponse("openai", "claude",
      { id: "chatcmpl-1", object: "chat.completion.chunk", model: "glm-5.3", choices: [{ delta: { content: "hi" } }] }, state);
    const start = events.find(e => e.type === "message_start");
    expect(start.message.model).toBe("glm-5.3");
  });
});

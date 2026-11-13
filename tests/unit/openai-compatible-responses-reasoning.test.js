// Locks the wire shape of reasoning for openai-compatible nodes with apiType
// "responses". applyThinking() normalizes effort to the Chat shape (top-level
// reasoning_effort) because the capability entry describes /chat/completions, and
// nothing re-nested it before the request reached the Responses endpoint.
//
// Regression for: any effort-bearing request through such a node failed with
// 400 "Unsupported parameter: 'reasoning_effort'. In the Responses API, this
// parameter has moved to 'reasoning.effort'" (seen with api.openai.com), while
// the same node on apiType "chat" worked. codex / opencode-go / opencode-zen
// executors already did this normalization themselves.
import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";
import { translateRequest } from "open-sse/translator/index.js";
import { FORMATS } from "open-sse/translator/formats.js";

const RESPONSES_ID = "openai-compatible-responses-11111111-2222-3333-4444-555555555555";
const CHAT_ID = "openai-compatible-chat-3d8d3de8-1206-47ee-a42f-22113a5f2387";
const BASE = "https://api.openai.com/v1";
const MODEL = "gpt-6.1-terra";

const creds = (apiType) => ({ apiKey: "sk-test", providerSpecificData: { baseUrl: BASE, apiType } });
const send = (provider, body, apiType) =>
  new DefaultExecutor(provider).transformRequest(MODEL, body, false, creds(apiType));

const chatRequest = (effort) => ({
  model: MODEL,
  messages: [{ role: "user", content: "hi" }],
  reasoning_effort: effort,
});

describe("openai-compatible responses node — reasoning wire shape", () => {
  it("nests reasoning_effort as reasoning:{effort,summary} and drops the Chat field", () => {
    const out = send(RESPONSES_ID, chatRequest("high"), "responses");
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("keeps a client-supplied summary while taking the applied effort", () => {
    const out = send(RESPONSES_ID, {
      ...chatRequest("low"),
      reasoning: { summary: "detailed" },
    }, "responses");
    expect(out.reasoning).toEqual({ summary: "detailed", effort: "low" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("defaults summary for a body that already carries nested reasoning", () => {
    const out = send(RESPONSES_ID, {
      model: MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      reasoning: { effort: "medium" },
    }, "responses");
    expect(out.reasoning).toEqual({ effort: "medium", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("leaves the Chat-shaped field alone on an apiType chat node (control)", () => {
    const out = send(CHAT_ID, chatRequest("high"), "chat");
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning).toBeUndefined();
  });

  it("leaves a regular provider untouched (control)", () => {
    const out = new DefaultExecutor("openai").transformRequest(MODEL, chatRequest("high"), false, creds(undefined));
    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning).toBeUndefined();
  });

  it("reconciles the translated body end-to-end (openai client → responses node)", () => {
    // translateRequest applies thinking after translation: the Responses translator
    // already built reasoning, then applyThinking re-added the Chat field.
    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      MODEL,
      chatRequest("high"),
      false,
      creds("responses"),
      RESPONSES_ID,
    );
    expect(translated.reasoning_effort).toBe("high"); // Chat shape emitted upstream of the executor
    const out = send(RESPONSES_ID, translated, "responses");
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep the signature store in RAM only; the SQLite kv layer is not under test here.
vi.mock("@/lib/db/helpers/kvStore.js", () => ({
  makeKv: () => ({
    get: async () => null,
    set: async () => {},
    remove: async () => {},
    getAll: async () => ({}),
  }),
}));

const {
  storeGeminiThoughtSignature,
  getGeminiThoughtSignatureSync,
  signatureFamily,
} = await import("../../open-sse/services/thoughtSignatureStore.js");
const { openaiToAntigravityRequest } = await import("../../open-sse/translator/request/openai-to-gemini.js");
const { geminiToOpenAIResponse } = await import("../../open-sse/translator/response/gemini-to-openai.js");
const { DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } = await import("../../open-sse/config/defaultThinkingSignature.js");

let n = 0;
const uid = (p) => `${p}_${Date.now()}_${n++}`;

function toolHistory(callId) {
  return {
    messages: [
      { role: "user", content: "list files" },
      { role: "assistant", content: null, tool_calls: [{ id: callId, type: "function", function: { name: "ls", arguments: "{}" } }] },
      { role: "tool", tool_call_id: callId, content: "a.txt" },
    ],
  };
}

function functionCallSignatures(req) {
  return req.request.contents.flatMap((c) => c.parts || []).filter((p) => p.functionCall).map((p) => p.thoughtSignature);
}

describe("antigravity thought signatures are scoped to the model family", () => {
  beforeEach(() => { n++; });

  it("classifies model families", () => {
    expect(signatureFamily("claude-opus-4-6-thinking")).toBe("claude");
    expect(signatureFamily("gemini-3.8-flash-tiered")).toBe("gemini");
    expect(signatureFamily("gpt-oss-120b-medium")).toBe("gpt-oss-120b-medium");
    expect(signatureFamily(null)).toBe(null);
  });

  it("does not return a Claude signature for a Gemini target (and vice versa)", () => {
    const claudeCall = uid("toolu");
    const geminiCall = uid("call");
    storeGeminiThoughtSignature(claudeCall, "CLAUDE_SIG", "sess", "claude-opus-4-6-thinking");
    storeGeminiThoughtSignature(geminiCall, "GEMINI_SIG", "sess", "gemini-3.8-flash-tiered");

    expect(getGeminiThoughtSignatureSync(claudeCall, "sess", "gemini-3.8-flash")).toBe(null);
    expect(getGeminiThoughtSignatureSync(claudeCall, "sess", "claude-opus-4-6-thinking")).toBe("CLAUDE_SIG");
    expect(getGeminiThoughtSignatureSync(geminiCall, "sess", "gemini-3.7-flash")).toBe("GEMINI_SIG");
    expect(getGeminiThoughtSignatureSync(geminiCall, null, "claude-sonnet-4-6")).toBe(null);
  });

  it("keeps old behaviour for untagged entries and untargeted lookups", () => {
    const call = uid("call");
    storeGeminiThoughtSignature(call, "LEGACY_SIG", "sess");
    expect(getGeminiThoughtSignatureSync(call, "sess", "gemini-3.8-flash")).toBe("LEGACY_SIG");

    const tagged = uid("toolu");
    storeGeminiThoughtSignature(tagged, "CLAUDE_SIG", "sess", "claude-opus-4-6-thinking");
    expect(getGeminiThoughtSignatureSync(tagged, "sess")).toBe("CLAUDE_SIG");
  });

  it("records the producing model from the Gemini response stream", () => {
    const call = uid("toolu_vrtx");
    const state = { model: "claude-opus-4-6-thinking", sessionId: null, toolNameMap: null };
    geminiToOpenAIResponse({
      response: {
        responseId: "r1",
        candidates: [{ content: { role: "model", parts: [{ functionCall: { id: call, name: "ls", args: {} }, thoughtSignature: "CLAUDE_SIG" }] } }],
      },
    }, state);
    expect(getGeminiThoughtSignatureSync(call, null, "gemini-3.8-flash-tiered")).toBe(null);
    expect(getGeminiThoughtSignatureSync(call, null, "claude-opus-4-6-thinking")).toBe("CLAUDE_SIG");
  });

  it("switching Claude -> Gemini mid-conversation sends the default signature, not Claude's", () => {
    const call = uid("toolu_vrtx");
    storeGeminiThoughtSignature(call, "CLAUDE_SIG", null, "claude-opus-4-6-thinking");
    const req = openaiToAntigravityRequest("gemini-3.8-flash-tiered", toolHistory(call), true);
    expect(functionCallSignatures(req)).toEqual([DEFAULT_THINKING_GEMINI_CLI_SIGNATURE]);
  });

  it("switching Gemini -> Claude mid-conversation does not replay Gemini's signature", () => {
    const call = uid("call");
    storeGeminiThoughtSignature(call, "GEMINI_SIG", null, "gemini-3.8-flash-tiered");
    const req = openaiToAntigravityRequest("claude-opus-4-6-thinking", toolHistory(call), true);
    expect(functionCallSignatures(req)).not.toContain("GEMINI_SIG");
  });

  it("same model family still reuses the cached signature", () => {
    const call = uid("call");
    storeGeminiThoughtSignature(call, "GEMINI_SIG", null, "gemini-3.8-flash-tiered");
    const req = openaiToAntigravityRequest("gemini-3.8-flash-tiered", toolHistory(call), true);
    expect(functionCallSignatures(req)).toEqual(["GEMINI_SIG"]);
  });
});

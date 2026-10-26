import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/helpers/kvStore.js", () => ({
  makeKv: () => ({
    get: async () => null,
    set: async () => {},
    remove: async () => {},
    getAll: async () => ({}),
  }),
}));

const { getCapabilitiesForModel, isGemini4Model } = await import("../../open-sse/providers/capabilities.js");
const { getThinkingLevels } = await import("../../open-sse/providers/thinkingLevels.js");
const { stripUnsupportedModalities } = await import("../../open-sse/translator/concerns/modality.js");
const { applyThinking, stripThinkingSuffix } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
const { claudeToOpenAIRequest } = await import("../../open-sse/translator/request/claude-to-openai.js");
const {
  openaiToGeminiRequest,
  openaiToGeminiCLIRequest,
  openaiToAntigravityRequest,
} = await import("../../open-sse/translator/request/openai-to-gemini.js");
const { openaiToVertexRequest } = await import("../../open-sse/translator/request/openai-to-vertex.js");
const { geminiToOpenAIResponse } = await import("../../open-sse/translator/response/gemini-to-openai.js");
const { openaiToClaudeResponse } = await import("../../open-sse/translator/response/openai-to-claude.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { getModelUpstreamId } = await import("../../open-sse/config/providerModels.js");
const { storeGeminiThoughtSignature, getGeminiThoughtSignatureSync } = await import("../../open-sse/services/thoughtSignatureStore.js");
const { isValidClaudeSignature } = await import("../../open-sse/utils/claudeSignature.js");
const {
  DEFAULT_THINKING_AG_SIGNATURE,
  DEFAULT_THINKING_CLAUDE_SIGNATURE,
  DEFAULT_THINKING_GEMINI_CLI_SIGNATURE,
  DEFAULT_THINKING_VERTEX_SIGNATURE,
} = await import("../../open-sse/config/defaultThinkingSignature.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const ALL_GEMINI_MODELS = [
  { id: "gemini-2.0-flash", provider: "gemini", format: null, reasoning: false },
  { id: "gemini-2.5-flash", provider: "gemini", format: "gemini-budget", reasoning: true },
  { id: "gemini-2.5-pro", provider: "gemini", format: "gemini-budget", reasoning: true },
  { id: "gemini-3-flash-preview", provider: "gemini", format: "gemini-level", reasoning: true },
  { id: "gemini-3.1-pro-high", provider: "antigravity", format: "gemini-level", reasoning: true },
  { id: "gemini-3.6-flash-high", provider: "antigravity", format: "gemini-level", reasoning: true },
  { id: "gemini-3.7-flash-high", provider: "antigravity", format: "gemini-level", reasoning: true },
  { id: "gemini-3.8-flash-high", provider: "antigravity", format: "gemini-level", reasoning: true },
  { id: "gemini-4-argon-low", provider: "antigravity", format: "gemini-level", reasoning: true },
  { id: "gemini-4-argon-medium", provider: "antigravity", format: "gemini-level", reasoning: true },
  { id: "gemini-4-argon-high", provider: "antigravity", format: "gemini-level", reasoning: true },
  { id: "gemini-4-argon", provider: "vertex", format: "gemini-level", reasoning: true },
];

// Real-shaped Gemini 3.x and Gemini 4 Argon thoughtSignatures from production
const REAL_GEMINI_3_SIG = Buffer.from(
  Buffer.concat([
    Buffer.from([0x12, 0x06, 0x0a, 0x04, 0x01, 0x69, 0x14, 0x7d]),
  ])
).toString("base64"); // Starts with 'E', byte 0 = 0x12, inner field 1 spans entire outer field 2

const REAL_GEMINI_4_ARGON_SIG = Buffer.from(
  Buffer.concat([
    Buffer.from([0x12, 0x26, 0x0a, 0x24]),
    Buffer.from("e24830a7-5cd6-4211-9a12-123456789abc", "utf8"),
  ])
).toString("base64"); // Exact 38-byte protobuf envelope emitted by Gemini 4 Argon

describe("All Gemini Versions (2.0, 2.5, 3.x, 3.6, 3.7, 3.8, 4 Argon) — Capabilities & Modalities", () => {
  it.each(ALL_GEMINI_MODELS)(
    "declares vision: true, pdf: true, and expected reasoning/context caps for $id ($provider)",
    ({ id, provider, format, reasoning }) => {
      const caps = getCapabilitiesForModel(provider, id);
      expect(caps.vision).toBe(true);
      expect(caps.pdf).toBe(true);
      expect(caps.reasoning).toBe(reasoning);
      expect(caps.thinkingFormat).toBe(format);
      expect(caps.contextWindow).toBe(1048576);
    }
  );

  it.each(ALL_GEMINI_MODELS)(
    "preserves Anthropic PDF document blocks through stripUnsupportedModalities -> claudeToOpenAI -> Gemini/Antigravity for $id",
    ({ id, provider }) => {
      const caps = getCapabilitiesForModel(provider, id);
      const claudeBody = {
        model: id,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Summarize this PDF specification" },
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: "JVBERi0xLjQKJeLjz9MK",
                },
              },
            ],
          },
        ],
      };

      // 1. Modality gate must NOT strip the PDF document block
      stripUnsupportedModalities(claudeBody, FORMATS.CLAUDE, caps);
      expect(claudeBody.messages[0].content).toHaveLength(2);
      expect(claudeBody.messages[0].content[1].type).toBe("document");

      // 2. Translate Claude -> OpenAI -> Antigravity / Gemini
      const openaiBody = claudeToOpenAIRequest(id, claudeBody, true);
      stripUnsupportedModalities(openaiBody, FORMATS.OPENAI, caps);

      const agReq = openaiToAntigravityRequest(id, openaiBody, true, { projectId: "p1", _clientSessionId: "claude:sess-1" });
      const userTurn = agReq.request.contents.find((c) => c.role === "user");
      const pdfPart = userTurn.parts.find((p) => p.inlineData?.mimeType === "application/pdf");
      expect(pdfPart).toBeDefined();
      expect(pdfPart.inlineData.data).toBe("JVBERi0xLjQKJeLjz9MK");
    }
  );
});

describe("Cross-Family Thought Signature Isolation & Protobuf Discrimination", () => {
  it("distinguishes Anthropic Claude signatures from Antigravity Gemini 3.x and Gemini 4 Argon signatures", () => {
    expect(isValidClaudeSignature(DEFAULT_THINKING_CLAUDE_SIGNATURE)).toBe(true);
    expect(isValidClaudeSignature(DEFAULT_THINKING_AG_SIGNATURE)).toBe(false);
    expect(isValidClaudeSignature(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE)).toBe(false);
    expect(isValidClaudeSignature(DEFAULT_THINKING_VERTEX_SIGNATURE)).toBe(false);
    expect(isValidClaudeSignature(REAL_GEMINI_3_SIG)).toBe(false);
    expect(isValidClaudeSignature(REAL_GEMINI_4_ARGON_SIG)).toBe(false);
  });

  it("never leaks DEFAULT_THINKING_CLAUDE_SIGNATURE from Claude Code thinking history onto Gemini tool_calls or thought parts", () => {
    // Multi-turn Claude Code Desktop payload: assistant turn has BOTH a thinking block
    // (signed with DEFAULT_THINKING_CLAUDE_SIGNATURE) AND a tool_use block.
    const claudeBody = {
      model: "claude-fable-5-1",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages: [
        { role: "user", content: "Check directory" },
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "I should list the directory contents first.",
              signature: DEFAULT_THINKING_CLAUDE_SIGNATURE,
            },
            {
              type: "tool_use",
              id: "toolu_unseen_in_cache",
              name: "Bash",
              input: { command: "ls -la" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_unseen_in_cache",
              content: "total 0",
            },
          ],
        },
      ],
    };

    const openaiBody = claudeToOpenAIRequest("gemini-4-argon-high", claudeBody, true);
    expect(openaiBody.messages[1].thought_signature).toBe(DEFAULT_THINKING_CLAUDE_SIGNATURE);

    // Translate across all 4 Gemini transports (Antigravity, Gemini CLI, Gemini API, Vertex)
    const agReq = openaiToAntigravityRequest("gemini-4-argon-high", openaiBody, true, {
      projectId: "proj-1",
      _clientSessionId: "claude:session-abc",
    });
    const agFinal = new AntigravityExecutor().transformRequest("gemini-4-argon-high", agReq, true, {
      projectId: "proj-1",
      connectionId: "conn-1",
    });

    const agModelTurn = agFinal.request.contents.find((c) => c.role === "model");
    const agFnCall = agModelTurn.parts.find((p) => p.functionCall);
    expect(agFnCall.thoughtSignature).not.toBe(DEFAULT_THINKING_CLAUDE_SIGNATURE);
    expect(agFnCall.thoughtSignature).toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);

    const geminiApiReq = openaiToGeminiRequest("gemini-3.8-flash", openaiBody, true);
    const geminiModelTurn = geminiApiReq.contents.find((c) => c.role === "model");
    for (const part of geminiModelTurn.parts) {
      if (part.thoughtSignature) {
        expect(part.thoughtSignature).not.toBe(DEFAULT_THINKING_CLAUDE_SIGNATURE);
      }
    }

    const vertexReq = openaiToVertexRequest("gemini-4-argon", openaiBody, true);
    const vertexModelTurn = vertexReq.contents.find((c) => c.role === "model");
    for (const part of vertexModelTurn.parts) {
      if (part.thoughtSignature) {
        expect(part.thoughtSignature).toBe(DEFAULT_THINKING_VERTEX_SIGNATURE);
      }
    }
  });

  it("recovers cached Gemini 4 Argon signature across both raw _clientSessionId and numeric sessionId in AntigravityExecutor", () => {
    const clientSessionId = "claude:90b30916-ea38-425f-85bd-f9d995124431";
    const callId = "toolu_argon_cached_1";

    // Simulate gemini-to-openai streaming storing the Argon signature under raw clientSessionId
    storeGeminiThoughtSignature(callId, REAL_GEMINI_4_ARGON_SIG, clientSessionId, "gemini-4-argon-high");

    const claudeBody = {
      model: "claude-fable-5-1",
      messages: [
        { role: "user", content: "Run check" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Running check...", signature: DEFAULT_THINKING_CLAUDE_SIGNATURE },
            { type: "tool_use", id: callId, name: "Bash", input: { command: "pwd" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: callId, content: "/home/user" }],
        },
      ],
    };

    const openaiBody = claudeToOpenAIRequest("gemini-4-argon-high", claudeBody, true);
    const agReq = openaiToAntigravityRequest("gemini-4-argon-high(high)", openaiBody, true, {
      projectId: "proj-1",
      _clientSessionId: clientSessionId,
    });
    const agFinal = new AntigravityExecutor().transformRequest("gemini-4-argon-high(high)", agReq, true, {
      projectId: "proj-1",
      connectionId: "conn-1",
    });

    const modelTurn = agFinal.request.contents.find((c) => c.role === "model");
    const fnPart = modelTurn.parts.find((p) => p.functionCall);
    expect(fnPart.thoughtSignature).toBe(REAL_GEMINI_4_ARGON_SIG);
  });
});

describe("Thinking & Sampling Normalization Across All Gemini Generations", () => {
  it("normalizes adaptive thinking + effort across Gemini 4 Argon, Gemini 3.x, Gemini 2.5, and Gemini 2.0", () => {
    // 1. Gemini 4 Argon: clamps minimal/none to low, strips temperature/topP/topK, maps effort to thinkingLevel
    const argonUpstream = getModelUpstreamId("ag", "gemini-4-argon", { output_config: { effort: "medium" } });
    expect(argonUpstream).toBe("gemini-4-argon-medium(medium)");

    const argonBody = openaiToAntigravityRequest(
      "gemini-4-argon-high(high)",
      {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        messages: [{ role: "user", content: "Hello Argon" }],
      },
      true
    );
    applyThinking("antigravity", "gemini-4-argon-high(high)", argonBody, "antigravity");
    const argonFinal = new AntigravityExecutor().transformRequest("gemini-4-argon-high(high)", argonBody, true, {
      projectId: "p1",
    });

    expect(argonFinal.model).toBe("gemini-4-argon-high");
    expect(argonFinal.request.generationConfig.temperature).toBeUndefined();
    expect(argonFinal.request.generationConfig.topP).toBeUndefined();
    expect(argonFinal.request.generationConfig.topK).toBeUndefined();
    expect(argonFinal.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "high",
      includeThoughts: true,
    });

    // 2. Gemini 3.8 Flash: preserves sampling params and sets thinkingLevel
    const g38Body = openaiToAntigravityRequest(
      "gemini-3.8-flash-tiered(high)",
      {
        temperature: 0.5,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        messages: [{ role: "user", content: "Hello 3.8" }],
      },
      true
    );
    applyThinking("antigravity", "gemini-3.8-flash-tiered(high)", g38Body, "antigravity");
    expect(g38Body.request.generationConfig.temperature).toBe(0.5);
    expect(g38Body.request.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "high",
      includeThoughts: true,
    });

    // 3. Gemini 2.5 Pro: uses thinkingBudget in [0, 24576]
    const g25Body = openaiToGeminiRequest(
      "gemini-2.5-pro",
      {
        thinking: { type: "enabled", budget_tokens: 16000 },
        messages: [{ role: "user", content: "Hello 2.5" }],
      },
      true
    );
    applyThinking("gemini", "gemini-2.5-pro", g25Body, "gemini");
    expect(g25Body.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 16000,
      includeThoughts: true,
    });

    // 4. Gemini 2.0 Flash: non-reasoning model strips thinkingConfig completely
    const g20Body = openaiToGeminiRequest(
      "gemini-2.0-flash",
      {
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        messages: [{ role: "user", content: "Hello 2.0" }],
      },
      true
    );
    applyThinking("gemini", "gemini-2.0-flash", g20Body, "gemini");
    expect(g20Body.generationConfig.thinkingConfig).toBeUndefined();
  });
});

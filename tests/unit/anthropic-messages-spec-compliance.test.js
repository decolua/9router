import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { openaiToGeminiRequest, openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { CLAUDE_BLOCK, OPENAI_BLOCK } from "../../open-sse/translator/schema/index.js";

describe("Anthropic Messages API 100% Spec Compliance & Antigravity Compatibility", () => {
  describe("PDF Document Block Translation", () => {
    it("translates CLAUDE_BLOCK.DOCUMENT into OPENAI_BLOCK.FILE", () => {
      const claudeReq = {
        model: "claude-sonnet-4.5",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Read this document:" },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: "JVBERi0xLjQK..."
              }
            }
          ]
        }]
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      const userMsg = openAI.messages.find(m => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(Array.isArray(userMsg.content)).toBe(true);

      const fileBlock = userMsg.content.find(p => p.type === OPENAI_BLOCK.FILE);
      expect(fileBlock).toBeDefined();
      expect(fileBlock.file.file_data).toContain("data:application/pdf;base64,JVBERi0xLjQK...");
    });

    it("passes document block to Antigravity as inlineData PDF", () => {
      const openAIBody = {
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Analyze PDF" },
            {
              type: "file",
              file: {
                file_data: "data:application/pdf;base64,JVBERi0xLjQK..."
              }
            }
          ]
        }]
      };

      const antigravity = openaiToAntigravityRequest("claude-opus-5-5[1m]", openAIBody, false);
      const contents = antigravity.request.contents;
      const userParts = contents.find(c => c.role === "user")?.parts;
      expect(userParts).toBeDefined();

      const docPart = userParts.find(p => p.inlineData && (p.inlineData.mimeType === "application/pdf" || p.inlineData.mime_type === "application/pdf"));
      expect(docPart).toBeDefined();
      expect(docPart.inlineData.data).toBe("JVBERi0xLjQK...");
      expect(docPart.inlineData.mimeType).toBe("application/pdf");
      expect(docPart.inlineData.mime_type).toBe("application/pdf");
    });
  });

  describe("Generation Controls Forwarding (stop_sequences, top_p, top_k)", () => {
    it("forwards stop_sequences, top_p, and top_k from Claude to OpenAI and Gemini", () => {
      const claudeReq = {
        model: "claude-sonnet-4.5",
        messages: [{ role: "user", content: "Hello" }],
        stop_sequences: ["\nHuman:", "<!-- stop -->"],
        top_p: 0.95,
        top_k: 40
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.stop).toEqual(["\nHuman:", "<!-- stop -->"]);
      expect(openAI.top_p).toBe(0.95);
      expect(openAI.top_k).toBe(40);

      const gemini = openaiToGeminiRequest("gemini-3-flash", openAI, false);
      expect(gemini.generationConfig.stopSequences).toEqual(["\nHuman:", "<!-- stop -->"]);
      expect(gemini.generationConfig.topP).toBe(0.95);
      expect(gemini.generationConfig.topK).toBe(40);

      const antigravity = openaiToAntigravityRequest("claude-opus-5-5[1m]", openAI, false);
      expect(antigravity.request.generationConfig.stopSequences).toEqual(["\nHuman:", "<!-- stop -->"]);
      expect(antigravity.request.generationConfig.topP).toBe(0.95);
      expect(antigravity.request.generationConfig.topK).toBe(40);
    });
  });

  describe("Extended Thinking & Thinking Budget Forwarding", () => {
    it("forwards thinking budget from Claude to OpenAI and Antigravity generationConfig", () => {
      const claudeReq = {
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Solve complex theorem" }],
        thinking: {
          type: "enabled",
          budget_tokens: 16384
        }
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
      expect(openAI.thinking_budget).toBe(16384);

      const antigravity = openaiToAntigravityRequest("claude-opus-5-5[1m]", openAI, false);
      expect(antigravity.request.generationConfig.thinkingConfig).toBeDefined();
      expect(antigravity.request.generationConfig.thinkingConfig.thinkingBudget).toBe(16384);
    });

    it("preserves assistant thinking and thought signature in multi-turn history", () => {
      const claudeReq = {
        model: "claude-sonnet-4.5",
        messages: [
          { role: "user", content: "Calculate 12 * 12" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "12 * 12 = 144", signature: "sig_abc123" },
              { type: "text", text: "The answer is 144." }
            ]
          },
          { role: "user", content: "Now multiply by 2" }
        ]
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      const asstMsg = openAI.messages.find(m => m.role === "assistant");
      expect(asstMsg).toBeDefined();
      expect(asstMsg.reasoning_content).toBe("12 * 12 = 144");
      expect(asstMsg.thought_signature).toBe("sig_abc123");

      const antigravity = openaiToAntigravityRequest("claude-opus-5-5[1m]", openAI, false);
      const modelTurn = antigravity.request.contents.find(c => c.role === "model");
      expect(modelTurn).toBeDefined();

      const thoughtPart = modelTurn.parts.find(p => p.thought === true);
      expect(thoughtPart).toBeDefined();
      expect(thoughtPart.text).toBe("12 * 12 = 144");

      const sigPart = modelTurn.parts.find(p => p.thoughtSignature);
      expect(sigPart).toBeDefined();
      expect(sigPart.thoughtSignature).toBe("sig_abc123");
    });
  });

  describe("SSE Streaming Thinking signature_delta Emission", () => {
    it("emits signature_delta before closing content_block_stop for thinking blocks", () => {
      const state = { toolCalls: new Map() };

      // Chunk 1: Thinking delta
      const chunk1 = {
        id: "chatcmpl-test",
        model: "claude-opus-5-5[1m]",
        choices: [{
          delta: {
            reasoning_content: "Thinking about step 1...",
            thought_signature: "sig_upstream_real"
          }
        }]
      };

      const events1 = openaiToClaudeResponse(chunk1, state);
      expect(events1.some(e => e.type === "content_block_start" && e.content_block.type === "thinking")).toBe(true);
      expect(events1.some(e => e.type === "content_block_delta" && e.delta.thinking === "Thinking about step 1...")).toBe(true);

      // Chunk 2: Regular text content arrives -> stops thinking block
      const chunk2 = {
        id: "chatcmpl-test",
        model: "claude-opus-5-5[1m]",
        choices: [{
          delta: {
            content: "Here is the solution."
          }
        }]
      };

      const events2 = openaiToClaudeResponse(chunk2, state);

      // Verify signature_delta is emitted before content_block_stop
      const sigDeltaIdx = events2.findIndex(e => e.type === "content_block_delta" && e.delta.type === "signature_delta");
      const stopIdx = events2.findIndex(e => e.type === "content_block_stop");

      expect(sigDeltaIdx).toBeGreaterThanOrEqual(0);
      expect(stopIdx).toBeGreaterThan(sigDeltaIdx);
      expect(events2[sigDeltaIdx].delta.signature).toBe("sig_upstream_real");
    });
  });

  describe("Tool Choice Mapping (auto, any, tool, none)", () => {
    const tools = [{
      name: "bash",
      description: "run command",
      input_schema: { type: "object", properties: { cmd: { type: "string" } } }
    }];

    it("maps tool_choice { type: 'any' } to Gemini functionCallingConfig ANY", () => {
      const claudeReq = {
        model: "claude-sonnet-4.5",
        messages: [{ role: "user", content: "Run bash" }],
        tools,
        tool_choice: { type: "any" }
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.tool_choice).toBe("required");

      const antigravity = openaiToAntigravityRequest("claude-opus-5-5[1m]", openAI, false);
      expect(antigravity.request.toolConfig.functionCallingConfig.mode).toBe("ANY");
    });

    it("maps tool_choice { type: 'tool', name: 'bash' } to Gemini allowedFunctionNames", () => {
      const claudeReq = {
        model: "claude-sonnet-4.5",
        messages: [{ role: "user", content: "Run bash" }],
        tools,
        tool_choice: { type: "tool", name: "bash" }
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.tool_choice).toEqual({ type: "function", function: { name: "bash" } });

      const antigravity = openaiToAntigravityRequest("claude-opus-5-5[1m]", openAI, false);
      expect(antigravity.request.toolConfig.functionCallingConfig.mode).toBe("ANY");
      expect(antigravity.request.toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(["bash"]);
    });
  });
});

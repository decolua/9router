import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { OPENAI_BLOCK, ROLE } from "../../open-sse/translator/schema/index.js";

describe("Anthropic 100% Spec Parity & Antigravity Compatibility Suite", () => {
  describe("is_error Preservation in tool_result", () => {
    it("preserves is_error: true through Claude -> OpenAI -> Antigravity pipeline (Claude on Antigravity)", () => {
      const claudeReq = {
        model: "claude-opus-5-5[1m]",
        messages: [
          { role: "user", content: "Run bash command" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_fail_1",
                name: "bash",
                input: { command: "cat non_existent.txt" }
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_fail_1",
                content: "cat: non_existent.txt: No such file or directory",
                is_error: true
              }
            ]
          }
        ]
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      const toolMsg = openAI.messages.find(m => m.role === ROLE.TOOL);
      expect(toolMsg).toBeDefined();
      expect(toolMsg.is_error).toBe(true);
      expect(toolMsg.content).toContain("No such file or directory");

      const antigravity = openaiToAntigravityRequest(claudeReq.model, openAI, false);
      const userContents = antigravity.request.contents.filter(c => c.role === "user");
      const fnRespPart = userContents.flatMap(c => c.parts).find(p => p.functionResponse);
      expect(fnRespPart).toBeDefined();
      expect(fnRespPart.functionResponse.id).toBe("toolu_fail_1");
      expect(fnRespPart.functionResponse.response.is_error).toBe(true);
      expect(fnRespPart.functionResponse.response.error).toBeDefined();
      expect(JSON.stringify(fnRespPart.functionResponse.response.error)).toContain("No such file or directory");
    });

    it("preserves is_error: true through Claude -> OpenAI -> Antigravity pipeline (Gemini CLI on Antigravity)", () => {
      const claudeReq = {
        model: "gemini-2.5-pro",
        messages: [
          { role: "user", content: "Run bash command" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_fail_2",
                name: "bash",
                input: { command: "cat non_existent.txt" }
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_fail_2",
                content: "cat: non_existent.txt: No such file or directory",
                is_error: true
              }
            ]
          }
        ]
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      const antigravity = openaiToAntigravityRequest(claudeReq.model, openAI, false);
      const fnRespPart = antigravity.request.contents.flatMap(c => c.parts).find(p => p.functionResponse);
      expect(fnRespPart).toBeDefined();
      expect(fnRespPart.functionResponse.id).toBe("toolu_fail_2");
      expect(fnRespPart.functionResponse.response.is_error).toBe(true);
      expect(fnRespPart.functionResponse.response.error).toBeDefined();
    });

    it("handles success tool_result without is_error flag", () => {
      const claudeReq = {
        model: "claude-opus-5-5[1m]",
        messages: [
          { role: "user", content: "Echo greeting" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_ok_1",
                name: "bash",
                input: { command: "echo hello" }
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_ok_1",
                content: "hello"
              }
            ]
          }
        ]
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      const toolMsg = openAI.messages.find(m => m.role === ROLE.TOOL);
      expect(toolMsg).toBeDefined();
      expect(toolMsg.is_error).toBeUndefined();

      const antigravity = openaiToAntigravityRequest(claudeReq.model, openAI, false);
      const fnRespPart = antigravity.request.contents.flatMap(c => c.parts).find(p => p.functionResponse);
      expect(fnRespPart).toBeDefined();
      expect(fnRespPart.functionResponse.response.is_error).toBeUndefined();
      expect(fnRespPart.functionResponse.response.result).toBeDefined();
    });
  });

  describe("Adaptive Thinking Parity", () => {
    it("maps thinking: { type: 'adaptive' } to thinkingBudget: -1 in Antigravity", () => {
      const claudeReq = {
        model: "claude-opus-5-5[1m]",
        messages: [{ role: "user", content: "Analyze algorithm complexity" }],
        thinking: { type: "adaptive" }
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.thinking).toEqual({ type: "adaptive" });
      expect(openAI.thinking_budget).toBe(-1);

      const antigravity = openaiToAntigravityRequest(claudeReq.model, openAI, false);
      expect(antigravity.request.generationConfig.thinkingConfig).toBeDefined();
      expect(antigravity.request.generationConfig.thinkingConfig.thinkingBudget).toBe(-1);
    });
  });

  describe("Tool Choice: 'none' & disable_parallel_tool_use", () => {
    const tools = [{
      name: "bash",
      description: "run command",
      input_schema: { type: "object", properties: { cmd: { type: "string" } } }
    }];

    it("maps tool_choice { type: 'none' } to Gemini functionCallingConfig mode NONE (Claude on Antigravity)", () => {
      const claudeReq = {
        model: "claude-sonnet-4.5",
        messages: [{ role: "user", content: "Do not use tools" }],
        tools,
        tool_choice: { type: "none" }
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.tool_choice).toBe("none");

      const antigravity = openaiToAntigravityRequest(claudeReq.model, openAI, false);
      expect(antigravity.request.toolConfig.functionCallingConfig.mode).toBe("NONE");
    });

    it("maps tool_choice { type: 'none' } to Gemini functionCallingConfig mode NONE (Gemini on Antigravity)", () => {
      const claudeReq = {
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: "Do not use tools" }],
        tools,
        tool_choice: { type: "none" }
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.tool_choice).toBe("none");

      const antigravity = openaiToAntigravityRequest(claudeReq.model, openAI, false);
      expect(antigravity.request.toolConfig.functionCallingConfig.mode).toBe("NONE");
    });

    it("maps disable_parallel_tool_use: true to parallel_tool_calls: false in OpenAI intermediate", () => {
      const claudeReq = {
        model: "claude-sonnet-4.5",
        messages: [{ role: "user", content: "Run single tool" }],
        tools,
        tool_choice: { type: "auto", disable_parallel_tool_use: true }
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      expect(openAI.parallel_tool_calls).toBe(false);
    });
  });

  describe("Thought Signature Replay on Assistant Tool Calls", () => {
    it("preserves msg.thought_signature on functionCall parts in multi-turn history", () => {
      const claudeReq = {
        model: "claude-opus-5-5[1m]",
        messages: [
          { role: "user", content: "List directory" },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Need to list directory", signature: "sig_custom_asst_1" },
              {
                type: "tool_use",
                id: "toolu_list_1",
                name: "bash",
                input: { command: "ls" }
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_list_1",
                content: "file1.txt\nfile2.txt"
              }
            ]
          }
        ]
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);
      const antigravity = openaiToAntigravityRequest(claudeReq.model, openAI, false);

      const modelTurn = antigravity.request.contents.find(c => c.role === "model");
      expect(modelTurn).toBeDefined();

      const fnCallPart = modelTurn.parts.find(p => p.functionCall);
      expect(fnCallPart).toBeDefined();
      expect(fnCallPart.thoughtSignature).toBe("sig_custom_asst_1");
    });
  });

  describe("cache_control Preservation", () => {
    it("preserves cache_control on system, tools, user text, and tool_result", () => {
      const claudeReq = {
        model: "claude-opus-5-5[1m]",
        system: [
          {
            type: "text",
            text: "You are an expert engineer.",
            cache_control: { type: "ephemeral" }
          }
        ],
        tools: [
          {
            name: "bash",
            description: "run command",
            input_schema: { type: "object", properties: { cmd: { type: "string" } } },
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Prompt cached context",
                cache_control: { type: "ephemeral" }
              }
            ]
          },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_cached_1",
                name: "bash",
                input: { command: "pwd" }
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_cached_1",
                content: "/workspace",
                cache_control: { type: "ephemeral" }
              }
            ]
          }
        ]
      };

      const openAI = claudeToOpenAIRequest(claudeReq.model, claudeReq, false);

      // System cache_control
      const sysMsg = openAI.messages.find(m => m.role === ROLE.SYSTEM);
      expect(sysMsg.cache_control).toEqual({ type: "ephemeral" });

      // Tool cache_control
      const toolObj = openAI.tools.find(t => t.function.name === "bash");
      expect(toolObj.cache_control).toEqual({ type: "ephemeral" });

      // User text cache_control
      const userMsg = openAI.messages.find(m => m.role === ROLE.USER);
      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content.find(p => p.type === OPENAI_BLOCK.TEXT).cache_control).toEqual({ type: "ephemeral" });

      // Tool result cache_control
      const toolResultMsg = openAI.messages.find(m => m.role === ROLE.TOOL);
      expect(toolResultMsg.cache_control).toEqual({ type: "ephemeral" });
    });
  });
});
